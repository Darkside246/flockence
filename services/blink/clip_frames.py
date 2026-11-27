"""Three still frames from a saved clip, for Farm Vision's recording checks (2026-11-27).

The app picks a clip from each part of the day and asks for frames near its start, middle and end. Only Blink cloud
paths or files inside this service's own recordings and archive folders are accepted; anything else is refused.
"""
import asyncio
import base64
from pathlib import Path
import re

MAX_JPEG_BYTES = 512 * 1024
MAX_CLIP_BYTES = 80 * 1024 * 1024
RECORDING = re.compile(r"recordings/([A-Za-z0-9_-]{1,80})/([0-9]{8}-[0-9]{6}\.mp4)")
ARCHIVE = re.compile(r"archives/([A-Za-z0-9_-]{1,80})\.mp4")
BLINK = re.compile(r"/api/[A-Za-z0-9_./?=&%-]{1,400}")
DURATION = re.compile(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)")


def parse_duration(text):
    """Seconds from ffmpeg's "Duration: HH:MM:SS.xx" line, or None."""
    match = DURATION.search(text or "")
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    total = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    return total if total > 0 else None


def sample_times(duration):
    """Where to take the three frames: about 10%, 50% and 90% of the way through (or the start for a tiny clip)."""
    if not duration or duration < 1.5:
        return [0.0]
    return [round(duration * share, 2) for share in (0.1, 0.5, 0.9)]


def local_clip(source, media, recordings_dir, archive_path):
    """The file for a recording or archive clip, only inside those folders; None for anything else."""
    if source == "rtsp":
        match = RECORDING.fullmatch(media or "")
        if not match:
            return None
        path = Path(recordings_dir) / match.group(1) / match.group(2)
    elif source == "archive":
        match = ARCHIVE.fullmatch(media or "")
        if not match:
            return None
        try:
            path = Path(archive_path(match.group(1)))
        except (FileNotFoundError, ValueError):
            return None
    else:
        return None
    root = Path(recordings_dir).resolve() if source == "rtsp" else path.parent.resolve()
    if path.is_symlink() or not path.is_file() or root not in path.resolve().parents:
        return None
    return path


def blink_path(media):
    """A Blink cloud clip path this service may fetch, or None."""
    return media if isinstance(media, str) and BLINK.fullmatch(media) and ".." not in media else None


async def _run(args, timeout):
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.wait()
    return proc.returncode, out, err


async def clip_frames(ffmpeg, path):
    """Up to three JPEG frames (base64) from a local clip, in order."""
    _, _, err = await _run([ffmpeg, "-nostdin", "-hide_banner", "-protocol_whitelist", "file", "-i", str(path)], 10)
    frames = []
    for at in sample_times(parse_duration(err.decode("utf-8", "replace"))):
        code, data, _ = await _run([
            ffmpeg, "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file", "-ss", str(at), "-i", str(path),
            "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease",
            "-c:v", "mjpeg", "-q:v", "4", "-f", "image2pipe", "pipe:1",
        ], 10)
        if code == 0 and data.startswith(b"\xff\xd8\xff") and len(data) <= MAX_JPEG_BYTES:
            frames.append(base64.b64encode(data).decode("ascii"))
    return frames
