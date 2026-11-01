"""RTSP/ONVIF-style IP cameras.

Camera addresses (which usually embed a camera password) are stored server-side
in data/rtsp_cameras.json and are never returned by any endpoint.
Live view, snapshots and recordings all go through ffmpeg.
"""
import asyncio
import json
import os
import re
import shutil
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import imports as imported_clips
from settings import (DATA_DIR, FFMPEG, RECORD_KEEP_DAYS, RECORDINGS_DIR, SEGMENT_SECONDS,
                      require_token, slug)

STORE = DATA_DIR / "rtsp_cameras.json"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$")
recorders: dict[str, asyncio.subprocess.Process] = {}
router = APIRouter(dependencies=[Depends(require_token)])


def _load() -> dict[str, dict]:
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


def _save(data: dict[str, dict]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(data))
    try:
        os.chmod(STORE, 0o600)
    except OSError:
        pass


def has(name: str) -> bool:
    return name in _load()


def url_for(name: str) -> str:
    cam = _load().get(name)
    if not cam:
        raise HTTPException(404, "Unknown camera")
    return cam["url"]


def listing() -> list[dict]:
    return [
        {"name": n, "type": "rtsp", "source": "rtsp", "battery": None, "armed": None,
         "motionDetected": None, "recording": n in recorders and recorders[n].returncode is None}
        for n in _load()
    ]


def _rtsp_args(url: str) -> list[str]:
    return ["-loglevel", "error", "-rtsp_transport", "tcp", "-i", url]


# A dead camera must not make every dashboard visit wait: give up quickly, and
# remember the failure for a short while so repeated requests fail instantly.
SNAPSHOT_TIMEOUT = int(os.environ.get("RTSP_SNAPSHOT_TIMEOUT", "8"))
SNAPSHOT_RETRY_AFTER = int(os.environ.get("RTSP_SNAPSHOT_RETRY_AFTER", "30"))
_snapshot_failed_at: dict[str, float] = {}


async def snapshot(name: str) -> bytes:
    if not FFMPEG:
        raise HTTPException(501, "ffmpeg not found; set FFMPEG_PATH")
    failed_at = _snapshot_failed_at.get(name)
    if failed_at and time.time() - failed_at < SNAPSHOT_RETRY_AFTER:
        raise HTTPException(504, "Camera is not responding; will retry shortly")
    proc = await asyncio.create_subprocess_exec(
        FFMPEG, *_rtsp_args(url_for(name)), "-frames:v", "1", "-q:v", "3", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=SNAPSHOT_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        _snapshot_failed_at[name] = time.time()
        raise HTTPException(504, "Camera did not respond")
    if not out:
        _snapshot_failed_at[name] = time.time()
        raise HTTPException(502, "Could not read a frame from the camera")
    _snapshot_failed_at.pop(name, None)
    return out


async def spawn_live(name: str, out_dir: Path, stderr=None) -> asyncio.subprocess.Process:
    # Default: copy the camera's H.264 video (cheap, ~4s to first frame). Set
    # CAMERA_LIVE_TRANSCODE=1 for H.265 cameras, which browsers cannot play directly.
    # The caller may pass a private log file to capture FFmpeg startup failures.
    if os.environ.get("CAMERA_LIVE_TRANSCODE") == "1":
        codec = ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-g", "30", "-c:a", "aac"]
    else:
        codec = ["-c:v", "copy", "-c:a", "aac"]
    return await asyncio.create_subprocess_exec(
        FFMPEG, "-loglevel", "error", "-fflags", "nobuffer", "-analyzeduration", "1000000", "-probesize", "500000",
        "-rtsp_transport", "tcp", "-i", url_for(name), *codec,
        "-f", "hls", "-hls_time", "2", "-hls_list_size", "5",
        "-hls_flags", "delete_segments+omit_endlist", str(out_dir / "index.m3u8"),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=stderr if stderr is not None else asyncio.subprocess.DEVNULL,
    )


async def start_recording(name: str):
    if name in recorders and recorders[name].returncode is None:
        return
    out = RECORDINGS_DIR / slug(name)
    out.mkdir(parents=True, exist_ok=True)
    recorders[name] = await asyncio.create_subprocess_exec(
        FFMPEG, *_rtsp_args(url_for(name)),
        "-c:v", "copy", "-c:a", "aac",
        "-f", "segment", "-segment_time", str(SEGMENT_SECONDS), "-reset_timestamps", "1",
        "-segment_format", "mp4", "-segment_format_options", "movflags=+frag_keyframe+empty_moov",
        "-strftime", "1", str(out / "%Y%m%d-%H%M%S.mp4"),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )


async def stop_recording(name: str):
    proc = recorders.pop(name, None)
    if proc and proc.returncode is None:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), 10)
        except asyncio.TimeoutError:
            proc.kill()


async def supervise():
    """Restart recorders that died, and prune old recordings. Runs for the life of the app."""
    last_prune = 0.0
    while True:
        if FFMPEG:
            for name, cam in _load().items():
                if cam.get("record") and (name not in recorders or recorders[name].returncode is not None):
                    await start_recording(name)
        if time.time() - last_prune > 3600:
            last_prune = time.time()
            cutoff = time.time() - RECORD_KEEP_DAYS * 86400
            for f in RECORDINGS_DIR.glob("*/*.mp4"):
                try:
                    if f.stat().st_mtime < cutoff:
                        f.unlink()
                except OSError:
                    pass
        await asyncio.sleep(15)


async def shutdown():
    for name in list(recorders):
        await stop_recording(name)


def clips(camera: str | None = None, since: float | None = None) -> list[dict]:
    out = []
    for name in _load():
        if camera and name != camera:
            continue
        for f in sorted((RECORDINGS_DIR / slug(name)).glob("*.mp4"), reverse=True):
            try:
                created = datetime.strptime(f.stem, "%Y%m%d-%H%M%S")
                size = f.stat().st_size
            except (ValueError, OSError):
                continue
            if size == 0 or (since and created.timestamp() < since):
                continue
            out.append({"id": f"{slug(name)}/{f.name}", "camera": name, "source": "rtsp",
                        "createdAt": created.isoformat(), "media": f"recordings/{slug(name)}/{f.name}", "thumbnail": None})
    out.extend(imported_clips.clips(camera))
    return sorted(out, key=lambda c: c["createdAt"], reverse=True)


class NewCamera(BaseModel):
    name: str
    url: str
    record: bool = False


@router.post("/rtsp/cameras")
async def add_camera(body: NewCamera):
    name = body.name.strip()
    if not NAME_RE.match(name):
        raise HTTPException(400, "Name must be 1-40 letters, numbers, spaces, dashes or underscores")
    u = urlparse(body.url.strip())
    if u.scheme not in ("rtsp", "rtsps") or not u.hostname:
        raise HTTPException(400, "Address must look like rtsp://host:554/path")
    data = _load()
    if name in data or any(slug(n) == slug(name) for n in data):
        raise HTTPException(409, "A camera with that name already exists")
    data[name] = {"url": body.url.strip(), "record": body.record}
    _save(data)
    return {"name": name}


@router.delete("/rtsp/cameras/{name}")
async def remove_camera(name: str):
    data = _load()
    if name not in data:
        raise HTTPException(404, "Unknown camera")
    await stop_recording(name)
    del data[name]
    _save(data)
    shutil.rmtree(RECORDINGS_DIR / slug(name), ignore_errors=True)
    return {"removed": name}


@router.post("/rtsp/cameras/{name}/record/{action}")
async def set_recording(name: str, action: str):
    if action not in ("start", "stop"):
        raise HTTPException(404, "Not found")
    data = _load()
    if name not in data:
        raise HTTPException(404, "Unknown camera")
    if not FFMPEG:
        raise HTTPException(501, "ffmpeg not found; set FFMPEG_PATH")
    data[name]["record"] = action == "start"
    _save(data)
    if action == "start":
        await start_recording(name)
    else:
        await stop_recording(name)
    return {"recording": action == "start"}


@router.get("/recordings/{cam}/{filename}")
async def recording_file(cam: str, filename: str):
    if cam != Path(cam).name or filename != Path(filename).name or not filename.endswith(".mp4"):
        raise HTTPException(400, "Bad path")
    path = RECORDINGS_DIR / cam / filename
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="video/mp4")


# Clips added by hand (for example downloaded from the Blink app); see imports.py.
router.include_router(imported_clips.router)
