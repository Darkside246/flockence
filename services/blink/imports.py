"""Clips the farmer downloads from another app (for example the Blink app) and adds by hand.

Blink's own login is blocked for third-party libraries, but clips can still be downloaded from the Blink app.
This module lets those files be added to Flockence under a camera name so they show up in Recordings.

Files live in data/imports/<camera-slug>/<YYYYmmdd-HHMMSS>-<6 hex>.mp4 with a small .json file beside each
holding the camera label and the original file name. Only real MP4/MOV video is accepted.
"""
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from settings import DATA_DIR, require_token, slug

IMPORT_DIR = DATA_DIR / "imports"
MAX_BYTES = int(os.environ.get("IMPORT_MAX_MB", "500")) * 1024 * 1024
LABEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$")
FILE_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}\.mp4$")
SLUG_RE = re.compile(r"^[A-Za-z0-9_]+$")
router = APIRouter(dependencies=[Depends(require_token)])


def _is_video(path: Path) -> bool:
    """MP4 and QuickTime (.mov) files carry the box type 'ftyp' at byte 4."""
    try:
        with path.open("rb") as fh:
            head = fh.read(12)
    except OSError:
        return False
    return len(head) >= 12 and head[4:8] == b"ftyp"


def _parse_time(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "createdAt must be an ISO date and time")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@router.post("/imports/clips")
async def import_clip(request: Request, camera: str, created_at: str | None = None, filename: str | None = None):
    """Upload one video as the raw request body. `camera` is a label such as the Blink camera name."""
    label = camera.strip()
    if not LABEL_RE.match(label):
        raise HTTPException(400, "Camera name must be 1-60 letters, numbers, spaces, dots, dashes or underscores")
    stamp = _parse_time(created_at).astimezone()
    folder = IMPORT_DIR / slug(label)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{stamp:%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}.mp4"
    path, part = folder / name, folder / (name + ".part")

    size = 0
    try:
        with part.open("wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, f"Clip is larger than {MAX_BYTES // (1024 * 1024)} MB")
                fh.write(chunk)
        if size == 0 or not _is_video(part):
            raise HTTPException(415, "That file is not an MP4 or MOV video")
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    part.replace(path)
    meta = {"camera": label, "originalName": re.sub(r"[^A-Za-z0-9._ -]+", "_", (filename or ""))[:120], "createdAt": stamp.isoformat(), "bytes": size}
    (folder / (name + ".json")).write_text(json.dumps(meta))
    return {"id": f"import/{slug(label)}/{name}", "media": f"imports/{slug(label)}/{name}", **meta}


def clips(camera: str | None = None, limit: int = 300) -> list[dict]:
    """All imported clips, newest first. Added by hand on purpose, so they are not hidden by the recent-days window."""
    out: list[dict] = []
    for f in IMPORT_DIR.glob("*/*.mp4"):
        try:
            meta = json.loads((f.parent / (f.name + ".json")).read_text())
        except (OSError, ValueError):
            meta = {}
        label = meta.get("camera") or f.parent.name
        if camera and camera != label:
            continue
        created = meta.get("createdAt") or datetime.fromtimestamp(f.stat().st_mtime).isoformat()
        out.append({"id": f"import/{f.parent.name}/{f.name}", "camera": label, "source": "import", "createdAt": created,
                    "media": f"imports/{f.parent.name}/{f.name}", "thumbnail": None, "originalName": meta.get("originalName") or None})
    return sorted(out, key=lambda c: c["createdAt"], reverse=True)[:limit]


def _path(cam: str, filename: str) -> Path:
    if not SLUG_RE.match(cam) or not FILE_RE.match(filename):
        raise HTTPException(400, "Bad path")
    path = IMPORT_DIR / cam / filename
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return path


@router.get("/imports/{cam}/{filename}")
async def imported_file(cam: str, filename: str):
    return FileResponse(_path(cam, filename), media_type="video/mp4")


@router.delete("/imports/{cam}/{filename}")
async def delete_imported(cam: str, filename: str):
    path = _path(cam, filename)
    path.unlink()
    (path.parent / (filename + ".json")).unlink(missing_ok=True)
    try:
        path.parent.rmdir()  # drop the camera folder once its last clip is gone
    except OSError:
        pass
    return {"removed": filename}
