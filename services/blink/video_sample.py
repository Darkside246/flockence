"""Take a bounded ordered sample from the private local HLS stream."""
import asyncio
import base64
from pathlib import Path
import re

MAX_JPEG_BYTES = 256 * 1024
SEGMENT_NAME = re.compile(r"[A-Za-z0-9_-]{1,80}\.ts")


def playlist_segments(playlist: Path):
    try:
        with playlist.open("r", encoding="utf-8") as handle:
            text = handle.read(16385)
    except (OSError, UnicodeError):
        return []
    if len(text) > 16384 or not text.startswith("#EXTM3U"):
        return []
    return list(dict.fromkeys(line for raw in text.splitlines()
                              if SEGMENT_NAME.fullmatch(line := raw.strip())))


async def sample_jpeg(ffmpeg, segment):
    proc = await asyncio.create_subprocess_exec(
        ffmpeg, "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file",
        "-f", "mpegts", "-i", str(segment), "-map", "0:v:0", "-frames:v", "1",
        "-vf", "scale=512:512:force_original_aspect_ratio=decrease", "-c:v", "mjpeg",
        "-q:v", "5", "-f", "image2pipe", "pipe:1",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        data, _ = await asyncio.wait_for(proc.communicate(), timeout=4)
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.wait()
    if proc.returncode or len(data) > MAX_JPEG_BYTES or not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
        return None
    return base64.b64encode(data).decode("ascii")


async def sample_live_playlist(playlist, ffmpeg, reuse_existing=False):
    seen = set(playlist_segments(playlist)) if reuse_existing else set()
    frames = []
    clock = asyncio.get_running_loop()
    deadline = clock.time() + 16
    while len(frames) < 3 and clock.time() < deadline:
        for name in playlist_segments(playlist):
            if name in seen:
                continue
            seen.add(name)
            path = playlist.parent / name
            if path.is_symlink() or not path.is_file():
                continue
            try:
                frame = await sample_jpeg(ffmpeg, path)
            except (OSError, asyncio.TimeoutError):
                continue
            if frame:
                frames.append(frame)
                if len(frames) == 3:
                    break
        if len(frames) < 3:
            await asyncio.sleep(0.25)
    return frames
