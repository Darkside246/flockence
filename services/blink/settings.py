"""Shared configuration for the Flockence camera sidecar."""
import base64
import hmac
import ipaddress
import json
import logging
import os
import shutil
from pathlib import Path

from fastapi import Header, HTTPException

log = logging.getLogger("blink-sidecar")

# Everything the sidecar writes (recordings, live segments, imported clips, the Blink login) is readable by this
# service's own user only (security review 2026-11-01).
os.umask(0o077)

TOKEN = os.environ.get("BLINK_SIDECAR_TOKEN", "")
DATA_DIR = Path(os.environ.get("BLINK_DATA_DIR", Path(__file__).parent / "data")).resolve()
FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
LIVE_DIR = DATA_DIR / "live"
RECORDINGS_DIR = DATA_DIR / "recordings"
RECORD_KEEP_DAYS = int(os.environ.get("CAMERA_RECORD_KEEP_DAYS", "7"))
SEGMENT_SECONDS = int(os.environ.get("CAMERA_SEGMENT_SECONDS", "300"))


MIN_TOKEN_LENGTH = 32


def require_token(x_sidecar_token: str = Header(default="")):
    # Constant-time comparison: the token cannot be guessed one character at a time from response timing.
    if not TOKEN or not hmac.compare_digest(x_sidecar_token.encode(), TOKEN.encode()):
        raise HTTPException(401, "Unauthorized")


def _allowed_clients() -> list:
    """Loopback only, unless BLINK_SIDECAR_ALLOWED_CLIENTS names more (for example a container network)."""
    nets = [ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("::1/128")]
    for part in os.environ.get("BLINK_SIDECAR_ALLOWED_CLIENTS", "").split(","):
        part = part.strip()
        if part:
            try:
                nets.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                log.error("Ignoring bad BLINK_SIDECAR_ALLOWED_CLIENTS entry")
    return nets


ALLOWED_CLIENTS = _allowed_clients()


def client_allowed(host: str | None) -> bool:
    """Even if someone starts uvicorn with --host 0.0.0.0, only this machine (or listed networks) is answered."""
    try:
        address = ipaddress.ip_address((host or "").split("%")[0])
    except ValueError:
        return False
    return any(address in net for net in ALLOWED_CLIENTS)


# ── The saved Blink login, encrypted at rest ──────────────────────────────────────────────────────────────────────
# BLINK_CREDENTIALS_KEY: 32 random bytes, base64 (python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())").
# With the key, the login is stored as "v1:" + base64(nonce + AES-256-GCM ciphertext). An older plain JSON file is still
# read (so the cameras keep working) and is rewritten encrypted on the next save.

def _credentials_key() -> bytes | None:
    raw = os.environ.get("BLINK_CREDENTIALS_KEY", "").strip()
    if not raw:
        return None
    try:
        key = base64.b64decode(raw, validate=True)
    except ValueError:
        key = b""
    if len(key) != 32:
        raise RuntimeError("BLINK_CREDENTIALS_KEY must be 32 random bytes, base64")
    return key


def credentials_encrypted() -> bool:
    return _credentials_key() is not None


def seal_credentials(attrs: dict) -> str:
    key = _credentials_key()
    if key is None:
        return json.dumps(attrs)
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    sealed = AESGCM(key).encrypt(nonce, json.dumps(attrs).encode(), b"flockence-blink-credentials-v1")
    return "v1:" + base64.b64encode(nonce + sealed).decode()


def open_credentials(text: str) -> tuple[dict, bool]:
    """The saved login, and whether it was stored in plain text (so the caller can rewrite it encrypted)."""
    text = text.strip()
    if not text.startswith("v1:"):
        return json.loads(text), True
    key = _credentials_key()
    if key is None:
        raise RuntimeError("The saved Blink login is encrypted but BLINK_CREDENTIALS_KEY is not set")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    blob = base64.b64decode(text[3:])
    plain = AESGCM(key).decrypt(blob[:12], blob[12:], b"flockence-blink-credentials-v1")
    return json.loads(plain), False


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name)


GIB = 1024 ** 3
LIVE_LIMIT_BYTES = int(os.environ.get("CAMERA_LIVE_BUFFER_MIB", "64")) * 1024 ** 2

def storage_status():
    free = shutil.disk_usage(DATA_DIR).free
    return {"freeBytes": free, "low": free < 5 * GIB, "critical": free < 2 * GIB}

def require_camera_space(incoming=0):
    if shutil.disk_usage(DATA_DIR).free - incoming < 2 * GIB:
        raise HTTPException(507, "Camera storage needs at least 2 GiB free. Free space and retry.")
