"""Flockence Blink sidecar.

Local-only HTTP service wrapping blinkpy (unofficial Blink API). The Flockence
Next.js app calls this behind its own login; it must never be exposed publicly.

Run:  .venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8765
Env:  BLINK_SIDECAR_TOKEN (required), BLINK_IMPERSONATE (optional), FFMPEG_PATH (optional), BLINK_DATA_DIR (optional)
"""
import asyncio
import json
import logging
import os
import re
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

from blinkpy import api as blink_api
from blinkpy.auth import Auth, BlinkTwoFARequiredError
from blinkpy.blinkpy import Blink
from blinkpy.livestream import BlinkLiveStream
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from settings import require_camera_space, storage_status, LIVE_LIMIT_BYTES
import rtsp
from immi import extract_transport_stream_packets, patch_liveview_auth_header
from settings import DATA_DIR, FFMPEG, LIVE_DIR, MIN_TOKEN_LENGTH, TOKEN, client_allowed, credentials_encrypted, open_credentials, require_token, seal_credentials, slug as _slug
from transport import DEFAULT_IMPERSONATE, CurlCffiAiohttpAdapter

log = logging.getLogger("flockence.blink")

CRED_FILE = DATA_DIR / "credentials.json"
LIVE_MAX_SECONDS = int(os.environ.get("BLINK_LIVE_MAX_SECONDS", "300"))  # protect battery
RTSP_LIVE_MAX_SECONDS = int(os.environ.get("RTSP_LIVE_MAX_SECONDS", "3600"))
BLINK_IMPERSONATE = os.environ.get("BLINK_IMPERSONATE", DEFAULT_IMPERSONATE).strip() or DEFAULT_IMPERSONATE


class State:
    session: CurlCffiAiohttpAdapter | None = None
    blink: Blink | None = None
    pending_2fa = False
    lives: dict[str, "Live"] = {}


state = State()


class Live:
    def __init__(self, stream, proc, started, log_path: Path, feed_task=None):
        self.stream, self.proc, self.started, self.log_path = stream, proc, started, log_path
        self.feed_task = feed_task


def _ffmpeg_log_tail(path: Path, limit: int = 4000) -> str:
    """Return a small FFmpeg diagnostic tail with URLs redacted."""
    try:
        content = path.read_text(encoding="utf-8", errors="replace")[-limit:]
    except OSError:
        return "(FFmpeg produced no readable diagnostic log)"
    # FFmpeg may print an input URL. Do not leak RTSP credentials or stream URLs.
    return re.sub(
        r"(?i)\b([a-z][a-z0-9+.-]*://)\S+",
        r"\1[redacted]",
        content,
    ).strip() or "(FFmpeg produced no diagnostic output)"


async def _save_credentials():
    """Persist tokens only; never the account password. Encrypted when BLINK_CREDENTIALS_KEY is set."""
    attrs = dict(state.blink.auth.login_attributes)
    attrs.pop("password", None)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CRED_FILE.with_suffix(".tmp")
    tmp.write_text(seal_credentials(attrs))
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(CRED_FILE)
    if not credentials_encrypted():
        log.warning("The Blink login is saved WITHOUT encryption; set BLINK_CREDENTIALS_KEY to encrypt it")


async def _try_resume():
    if not CRED_FILE.exists():
        return
    try:
        attrs, was_plain = open_credentials(CRED_FILE.read_text())
        blink = Blink(session=state.session)
        blink.auth = Auth(attrs, no_prompt=True, session=state.session)
        if await blink.start():
            state.blink = blink
            log.info("Resumed Blink session")
            if was_plain and credentials_encrypted():
                await _save_credentials()
                log.info("Rewrote the saved Blink login encrypted")
    except Exception:
        log.exception("Could not resume saved Blink session; log in again")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not TOKEN:
        raise RuntimeError("BLINK_SIDECAR_TOKEN must be set")
    if len(TOKEN) < MIN_TOKEN_LENGTH:
        log.error("BLINK_SIDECAR_TOKEN is shorter than %d characters; replace it with a long random value", MIN_TOKEN_LENGTH)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # One persistent session covers OAuth, MFA, token refresh and camera calls.
    # Recreating it between steps would lose the cookies/session state Blink expects.
    state.session = CurlCffiAiohttpAdapter(impersonate=BLINK_IMPERSONATE)
    await _try_resume()
    supervisor = asyncio.create_task(rtsp.supervise())
    try:
        yield
    finally:
        supervisor.cancel()
        try:
            await supervisor
        except asyncio.CancelledError:
            pass
        await rtsp.shutdown()
        for name in list(state.lives):
            await _stop_live(name)
        if state.session is not None:
            await state.session.close()
            state.session = None


app = FastAPI(title="Flockence camera sidecar", lifespan=lifespan, dependencies=[Depends(require_token)],
              docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def only_this_machine(request, call_next):
    # Refused before the token is even looked at: the sidecar is never a public service.
    if not client_allowed(request.client.host if request.client else None):
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
app.include_router(rtsp.router)


def _blink() -> Blink:
    if not state.blink or not state.blink.available:
        raise HTTPException(409, "Blink is not connected")
    return state.blink


def _camera(name: str):
    cams = _blink().cameras
    if name not in cams:
        raise HTTPException(404, "Unknown camera")
    return cams[name]


class Login(BaseModel):
    username: str
    password: str


class Verify(BaseModel):
    pin: str


@app.get("/status")
async def status():
    return {
        "connected": bool(state.blink and state.blink.available),
        "pending2fa": state.pending_2fa,
        "ffmpeg": bool(FFMPEG),
        "storage": storage_status(),
    }


@app.post("/auth/login")
async def login(body: Login):
    if state.session is None:
        raise HTTPException(503, "Blink transport is not initialized")
    state.pending_2fa = False
    blink = Blink(session=state.session)
    blink.auth = Auth({"username": body.username, "password": body.password}, no_prompt=True, session=state.session)
    state.blink = blink
    try:
        ok = await blink.start()
    except BlinkTwoFARequiredError:
        state.pending_2fa = True
        return {"connected": False, "pending2fa": True}
    if not ok:
        state.blink = None
        raise HTTPException(401, "Blink login failed")
    state.pending_2fa = False
    await _save_credentials()
    return {"connected": True, "pending2fa": False}


@app.post("/auth/verify")
async def verify(body: Verify):
    if not state.blink or not state.pending_2fa:
        raise HTTPException(409, "No login awaiting verification")

    blink = state.blink
    try:
        verified = await blink.send_2fa_code(body.pin.strip())
    except Exception:
        log.exception("Blink MFA completion raised an unexpected error")
        auth = blink.auth
        retryable = all(
            hasattr(auth, attr)
            for attr in ("_oauth_csrf_token", "_oauth_code_verifier")
        )
        if not retryable:
            # Blink consumed the MFA/PKCE state, so this login cannot be resumed.
            state.pending_2fa = False
            state.blink = None
        raise HTTPException(502, "Blink verification could not complete camera setup. Check the sidecar log and start a fresh login if the verification screen clears.")

    if not verified:
        auth = blink.auth
        retryable = all(
            hasattr(auth, attr)
            for attr in ("_oauth_csrf_token", "_oauth_code_verifier")
        )
        if not retryable:
            # MFA and token exchange completed, but post-auth account setup failed.
            # BlinkPy has discarded the one-time OAuth state; asking for the code
            # again cannot work. Return the UI to the normal login flow.
            state.pending_2fa = False
            state.blink = None
            raise HTTPException(
                502,
                "Blink accepted the verification step but could not finish account setup. Check DNS/connectivity, then connect again.",
            )
        raise HTTPException(401, "Blink did not accept the verification code. Check the code and try again.")

    state.pending_2fa = False
    await _save_credentials()
    return {"connected": True, "pending2fa": False}


@app.post("/auth/logout")
async def logout():
    for name in list(state.lives):
        await _stop_live(name)
    state.blink, state.pending_2fa = None, False
    CRED_FILE.unlink(missing_ok=True)
    return {"connected": False}


@app.get("/cameras")
async def cameras():
    out = rtsp.listing()
    for c in out:
        c["live"] = c["name"] in state.lives
    if not (state.blink and state.blink.available):
        return out
    blink = state.blink
    for name, cam in blink.cameras.items():
        a = cam.attributes
        out.append({
            "name": name,
            "source": "blink",
            "type": a.get("type"),
            "battery": a.get("battery"),
            "temperature": a.get("temperature"),
            "armed": a.get("motion_enabled"),
            "motionDetected": a.get("motion_detected"),
            "thumbnail": a.get("thumbnail"),
            "live": name in state.lives,
        })
    return out


@app.get("/cameras/{name}/snapshot")
async def snapshot(name: str, fresh: bool = False):
    """Latest thumbnail, or take a new picture (wakes the camera, uses battery)."""
    if rtsp.has(name):
        return Response(await rtsp.snapshot(name), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    cam = _camera(name)
    if fresh:
        await cam.snap_picture()
        await asyncio.sleep(3)
        await _blink().refresh(force=True)
    resp = await cam.get_media()
    if resp is None or resp.status != 200:
        raise HTTPException(502, "Blink returned no image")
    return Response(await resp.read(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/clips")
async def clips(camera: str | None = None, since: str | None = None, pages: int = 2):
    since = since or time.strftime("%Y/%m/%d %H:%M", time.localtime(time.time() - 7 * 86400))
    out = rtsp.clips(camera, time.time() - 7 * 86400)
    if not (state.blink and state.blink.available) or (camera and rtsp.has(camera)):
        return out
    media = await state.blink.get_videos_metadata(since=since, stop=max(2, min(pages + 1, 6)))
    for m in media:
        if camera and m.get("device_name") != camera:
            continue
        out.append({
            "id": str(m.get("id")),
            "camera": m.get("device_name"),
            "createdAt": m.get("created_at"),
            "source": "blink",
            "media": m.get("media"),
            "thumbnail": m.get("thumbnail"),
        })
    return out


async def _proxy_blink_media(path: str, media_type: str):
    if not path.startswith("/api/"):  # only ever fetch Blink API paths
        raise HTTPException(400, "Invalid media path")
    resp = await _blink().do_http_get(path)
    if resp is None or resp.status != 200:
        raise HTTPException(502, "Blink returned no media")
    return Response(await resp.read(), media_type=media_type)


@app.get("/media/clip")
async def media_clip(path: str):
    return await _proxy_blink_media(path, "video/mp4")


@app.get("/media/thumb")
async def media_thumb(path: str):
    p = path if path.endswith(".jpg") else path + ".jpg"
    return await _proxy_blink_media(p, "image/jpeg")


# ---- live view: Blink immis (blinkpy local TCP MPEG-TS) or RTSP -> ffmpeg -> HLS ----


def _blink_live_video_args() -> list[str]:
    """How Blink's live video is prepared for the browser.

    BLINK_LIVE_MODE=quality (default): re-encode at high quality (CRF 18, full resolution and frame rate, no
    low-latency shortcuts that cost detail) with a keyframe exactly every 2 s, so every HLS piece is the same
    length and playback is smooth. Uses more of the PC's processor.
    BLINK_LIVE_MODE=copy: pass Blink's own H.264 through untouched (the best the camera sends, almost no
    processor), but the pieces follow Blink's keyframes, which can make playback less even.
    """
    if os.environ.get("BLINK_LIVE_MODE", "quality").strip().lower() == "copy":
        return ["-c:v", "copy", "-c:a", "aac", "-b:a", "128k"]
    return [
        "-c:v", "libx264", "-preset", "faster", "-crf", "18", "-maxrate", "6M", "-bufsize", "12M",
        "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-force_key_frames", "expr:gte(t,n_forced*1)", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k",
    ]

async def _stop_live(name: str):
    live = state.lives.pop(name, None)
    if not live:
        return
    if live.proc.returncode is None:
        try:
            live.proc.terminate()
            await asyncio.wait_for(live.proc.wait(), timeout=5)
        except ProcessLookupError:
            pass
        except asyncio.TimeoutError:
            live.proc.kill()
            await live.proc.wait()
    if live.stream:
        try:
            live.stream.stop()
        except Exception:
            log.exception("Could not stop Blink stream for %s", name)
    if live.feed_task:
        if not live.feed_task.done():
            live.feed_task.cancel()
        await asyncio.gather(live.feed_task, return_exceptions=True)
    shutil.rmtree(LIVE_DIR / _slug(name), ignore_errors=True)


async def _recv_blink_packets(stream):
    """Forward complete, sync-aligned MPEG-TS packets to FFmpeg."""
    reader = stream.target_reader
    if reader is None:
        raise RuntimeError("Blink relay reader was not initialized")
    ts_buffer = bytearray()
    try:
        while not reader.at_eof():
            try:
                header = await reader.readexactly(9)
            except asyncio.IncompleteReadError as exc:
                if exc.partial:
                    log.warning("Blink relay closed during packet header (%d/9 bytes)", len(exc.partial))
                break

            message_type = header[0]

            # Audio-config is a fixed, self-contained 9-byte IMMI message.
            # It has no following payload-length/body pair.
            if message_type == 0x0C:
                continue

            payload_length = int.from_bytes(header[5:9], byteorder="big")
            if payload_length <= 0:
                continue
            if payload_length > 8 * 1024 * 1024:
                log.warning("Blink relay sent an implausible IMMI payload length: %d", payload_length)
                break

            try:
                payload = await reader.readexactly(payload_length)
            except asyncio.IncompleteReadError as exc:
                log.warning(
                    "Blink relay closed during packet payload (%d/%d bytes)",
                    len(exc.partial), payload_length,
                )
                break

            if message_type != 0:
                continue

            # Outdoor 4 2K IMMI payloads can begin/end part-way through a
            # 188-byte MPEG-TS packet. Buffer across IMMI messages and recover
            # packet boundaries instead of dropping chunks whose first byte
            # is not 0x47.
            video_data = extract_transport_stream_packets(ts_buffer, payload)
            if not video_data:
                continue

            for writer in tuple(stream.clients):
                if not writer.is_closing():
                    writer.write(video_data)
                    await writer.drain()
            await asyncio.sleep(0)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("Error while receiving Blink MPEG-TS packets")
    finally:
        writer = stream.target_writer
        if writer is not None and not writer.is_closing():
            writer.close()


async def _init_blink_stream(camera):
    """Create the Blink stream while preserving its one-time IMMI auth token."""
    response = await blink_api.request_camera_liveview(
        camera.sync.blink,
        camera.sync.network_id,
        camera.camera_id,
        camera_type=camera.camera_type,
    )
    if not isinstance(response, dict):
        raise HTTPException(502, "Blink returned an invalid Live View response.")
    server = response.get("server")
    if not isinstance(server, str) or not server.startswith("immis://"):
        raise HTTPException(502, "Blink did not return a supported IMMI live-video endpoint.")

    # BlinkPy 0.25.9 discards this response field when init_livestream()
    # constructs BlinkLiveStream, then sends 64 zero bytes in its IMMI auth
    # header. Preserve the token and replace only that fixed header field.
    token = (
        response.get("liveview_token")
        or response.get("liveViewToken")
        or response.get("token")
    )
    stream = BlinkLiveStream(camera, response)
    original_get_auth_header = stream.get_auth_header
    stream.get_auth_header = lambda: patch_liveview_auth_header(
        original_get_auth_header(), token
    )
    if token:
        log.info("Blink Live View token received for %s", camera.name)
    else:
        log.warning("Blink Live View response did not include a session token for %s", camera.name)
    return stream


async def _start_blink_feed(stream, name: str):
    """Authenticate the Blink media relay and keep BlinkPy feeding local TCP."""
    relay_ready = asyncio.Event()
    original_auth = stream.auth

    async def auth_and_signal_ready():
        await original_auth()
        relay_ready.set()

    # This stream instance is private to one Live View request. Keep the
    # workaround scoped to it rather than patching BlinkPy globally.
    stream.auth = auth_and_signal_ready
    stream.recv = lambda: _recv_blink_packets(stream)
    task = asyncio.create_task(stream.feed(), name=f"blink-feed-{_slug(name)}")

    try:
        await asyncio.wait_for(relay_ready.wait(), timeout=15)
    except asyncio.TimeoutError:
        failure = None
        if task.done() and not task.cancelled():
            failure = task.exception()
        if failure:
            log.error(
                "Blink relay authentication failed for %s (%s): %s",
                name, type(failure).__name__, failure,
            )
            message = "Blink could not connect to the assigned live-video relay. The account is connected, but this relay refused or failed the connection."
            status_code = 502
        else:
            log.error("Blink relay authentication did not complete for %s within 15 seconds", name)
            message = "Blink's live-video relay did not connect within 15 seconds. Try Live View again."
            status_code = 504
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        stream.stop()
        raise HTTPException(status_code, message)

    log.info("Blink live-video relay connected for %s", name)
    return task


async def _reaper(name: str, live: Live, max_seconds: int):
    while name in state.lives and state.lives[name] is live:
        await asyncio.sleep(2)
        if state.lives.get(name) is not live:
            return
        folder = live.log_path.parent
        try:
            sizes = sum(f.stat().st_size for f in folder.iterdir() if f.is_file())
            age = time.time() - (folder / "index.m3u8").stat().st_mtime
        except FileNotFoundError:
            if time.time() - live.started < 30:
                continue
            sizes, age = 0, 31
        if storage_status()["critical"] or sizes > LIVE_LIMIT_BYTES or age > 30:
            log.warning("Stopped live view for %s: disk reserve, buffer limit or stale playlist (bytes=%d age=%.1fs)", name, sizes, age)
            await _stop_live(name)
            return
        elapsed = time.time() - live.started
        if live.feed_task and live.feed_task.done():
            failure = None
            if not live.feed_task.cancelled():
                failure = live.feed_task.exception()
            log.error(
                "Blink live relay feed ended for %s after %.1fs%s",
                name, elapsed,
                f": {type(failure).__name__}: {failure}" if failure else " without an exception",
            )
            await _stop_live(name)
            return
        if live.proc.returncode is not None:
            detail = _ffmpeg_log_tail(live.log_path)
            log.error(
                "Live FFmpeg process for %s exited unexpectedly after %.1fs (exit=%s): %s",
                name, elapsed, live.proc.returncode, detail,
            )
            await _stop_live(name)
            return
        if elapsed > max_seconds:
            log.info("Live view reached its configured %.0fs limit for %s", max_seconds, name)
            await _stop_live(name)
            return


@app.post("/cameras/{name}/live/start")
async def live_start(name: str):
    if not FFMPEG:
        raise HTTPException(501, "ffmpeg not found; set FFMPEG_PATH")
    require_camera_space()
    is_rtsp = rtsp.has(name)
    max_seconds = RTSP_LIVE_MAX_SECONDS if is_rtsp else LIVE_MAX_SECONDS
    reply = {"playlist": f"/live/{_slug(name)}/index.m3u8", "expiresIn": max_seconds}
    existing = state.lives.get(name)
    if existing:
        playlist = LIVE_DIR / _slug(name) / "index.m3u8"
        if existing.proc.returncode is None and playlist.is_file() and playlist.stat().st_size:
            return reply
        await _stop_live(name)

    out = LIVE_DIR / _slug(name)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    log_path = out / "ffmpeg.log"
    stream = None
    feed_task = None

    # Preserve FFmpeg diagnostics locally instead of discarding stderr. URLs
    # are redacted before anything is written to the application log.
    try:
        with log_path.open("w", encoding="utf-8", errors="replace") as ffmpeg_log:
            if is_rtsp:
                proc = await rtsp.spawn_live(name, out, stderr=ffmpeg_log)
            else:
                stream = await _init_blink_stream(_camera(name))
                await stream.start(host="127.0.0.1")
                # BlinkPy needs both start() and feed(): start() opens the
                # local TCP listener, while feed() authenticates to the IMMI
                # relay and forwards MPEG-TS packets to FFmpeg.
                feed_task = await _start_blink_feed(stream, name)
                proc = await asyncio.create_subprocess_exec(
                    FFMPEG, "-loglevel", "warning", "-fflags", "+genpts+discardcorrupt", "-i", stream.url,
                    *_blink_live_video_args(),
                    "-f", "hls", "-hls_time", "1", "-hls_list_size", "8",
                    "-hls_flags", "temp_file+delete_segments+omit_endlist+independent_segments", str(out / "index.m3u8"),
                    stdout=asyncio.subprocess.DEVNULL, stderr=ffmpeg_log,
                )
    except Exception:
        if feed_task and not feed_task.done():
            feed_task.cancel()
        if feed_task:
            await asyncio.gather(feed_task, return_exceptions=True)
        if stream:
            stream.stop()
        raise

    live = Live(stream, proc, time.time(), log_path, feed_task)
    state.lives[name] = live

    # Do not report success until FFmpeg has actually created the HLS playlist.
    # The browser previously received a successful start response and then
    # polled a permanently missing file while FFmpeg failures were hidden.
    playlist = out / "index.m3u8"
    deadline = asyncio.get_running_loop().time() + 20
    while asyncio.get_running_loop().time() < deadline:
        if feed_task and feed_task.done():
            failure = None
            if not feed_task.cancelled():
                failure = feed_task.exception()
            log.error(
                "Blink live relay stopped before producing video for %s%s",
                name,
                f": {type(failure).__name__}: {failure}" if failure else "",
            )
            await _stop_live(name)
            raise HTTPException(502, "Blink's video relay disconnected before it delivered a playable stream. Try Live View again.")
        if proc.returncode is not None:
            detail = _ffmpeg_log_tail(log_path)
            log.error(
                "FFmpeg exited before producing a live playlist for %s (exit=%s): %s",
                name, proc.returncode, detail,
            )
            await _stop_live(name)
            raise HTTPException(502, "The camera stream process exited before producing video. See the Blink sidecar console for sanitized FFmpeg diagnostics.")
        if playlist.is_file() and playlist.stat().st_size > 0:
            asyncio.create_task(_reaper(name, live, max_seconds))
            return reply
        await asyncio.sleep(0.25)

    detail = _ffmpeg_log_tail(log_path)
    log.error("FFmpeg did not produce a live playlist for %s within 20 seconds: %s", name, detail)
    await _stop_live(name)
    raise HTTPException(504, "The camera stream did not produce a video playlist within 20 seconds. See the Blink sidecar console for sanitized FFmpeg diagnostics.")


@app.post("/cameras/{name}/live/stop")
async def live_stop(name: str):
    await _stop_live(name)
    return {"live": False}


@app.get("/live/{slug}/{filename}")
async def live_file(slug: str, filename: str):
    if not re.fullmatch(r"[A-Za-z0-9_]+", slug) or not re.fullmatch(r"index(?:\.m3u8|[0-9]+\.ts)", filename):
        raise HTTPException(404, "Unknown stream file")
    path = LIVE_DIR / slug / filename
    try:
        data = await asyncio.to_thread(path.read_bytes)
    except FileNotFoundError:
        raise HTTPException(404, "Not ready")
    mt = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t"
    return Response(data, media_type=mt, headers={"Cache-Control": "no-store"})
