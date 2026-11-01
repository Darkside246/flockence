"""Shared configuration for the Flockence camera sidecar."""
import os
import shutil
from pathlib import Path

from fastapi import Header, HTTPException

TOKEN = os.environ.get("BLINK_SIDECAR_TOKEN", "")
DATA_DIR = Path(os.environ.get("BLINK_DATA_DIR", Path(__file__).parent / "data")).resolve()
FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
LIVE_DIR = DATA_DIR / "live"
RECORDINGS_DIR = DATA_DIR / "recordings"
RECORD_KEEP_DAYS = int(os.environ.get("CAMERA_RECORD_KEEP_DAYS", "7"))
SEGMENT_SECONDS = int(os.environ.get("CAMERA_SEGMENT_SECONDS", "300"))


def require_token(x_sidecar_token: str = Header(default="")):
    if not TOKEN or x_sidecar_token != TOKEN:
        raise HTTPException(401, "Unauthorized")


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name)
