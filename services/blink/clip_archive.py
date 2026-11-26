"""Bounded, per-worker archive for clips published by Blink's media feed."""
import asyncio
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import logging
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

ID = re.compile(r"^[a-f0-9]{64}$")
SAFE_PATH = re.compile(r"/api/[A-Za-z0-9_./-]{1,400}")
MAX_CLIP = 48 * 1024 * 1024


def utc_stamp(raw):
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Clip timestamp must include its zone")
    return value.astimezone(timezone.utc)


def transfer_url(base, media):
    origin = urlsplit(base)
    if (
        origin.scheme != "https" or origin.username or origin.password or origin.path not in ("", "/")
        or origin.query or origin.fragment or origin.port not in (None, 443)
        or not (origin.hostname or "").endswith(".immedia-semi.com")
    ):
        raise ValueError("Unsupported Blink media origin")
    if not isinstance(media, str) or not SAFE_PATH.fullmatch(media) or "//" in media or ".." in media:
        raise ValueError("Unsupported Blink media path")
    return base.rstrip("/") + media


class ClipArchive:
    def __init__(self, root, cameras, days=30, quota=1024 * 1024 * 1024):
        self.root = root
        self.cameras = cameras
        self.days = days
        self.quota = quota

    def rows(self, cutoff=None):
        rows = []
        for index in self.root.glob("*.json"):
            if not ID.fullmatch(index.stem) or index.is_symlink():
                continue
            try:
                clip = json.loads(index.read_text())
                media = self.root / (index.stem + ".mp4")
                if media.is_symlink() or not media.is_file():
                    continue
                captured = utc_stamp(clip["createdAt"])
                if cutoff and captured < cutoff:
                    continue
                rows.append({
                    "id": index.stem, "camera": str(clip["camera"])[:128], "createdAt": captured.isoformat(),
                    "bytes": media.stat().st_size, "source": "archive",
                    "media": "archives/" + index.stem + ".mp4", "thumbnail": None,
                })
            except (OSError, ValueError, TypeError, AttributeError, KeyError):
                continue
        return sorted(rows, key=lambda clip: clip["createdAt"], reverse=True)

    def path(self, key):
        if not ID.fullmatch(key):
            raise FileNotFoundError("Archive clip not found.")
        media = self.root / (key + ".mp4")
        index = self.root / (key + ".json")
        if index.is_symlink() or media.is_symlink() or not index.is_file() or not media.is_file():
            raise FileNotFoundError("Archive clip not found.")
        return media

    def prune(self, now):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        cutoff = now - timedelta(days=self.days)
        used = 0
        for file in self.root.iterdir():
            if file.is_symlink() or not ID.fullmatch(file.stem):
                continue
            if file.suffix != ".mp4" or not file.is_file():
                continue
            index = file.with_suffix(".json")
            try:
                timestamp = utc_stamp(json.loads(index.read_text())["createdAt"])
            except (OSError, ValueError, TypeError, AttributeError, KeyError):
                timestamp = datetime.fromtimestamp(file.stat().st_mtime, timezone.utc)
            if timestamp < cutoff:
                index.unlink(missing_ok=True)
                file.unlink(missing_ok=True)
            else:
                used += file.stat().st_size
        return used

    async def save(self, clip, account, origin, headers, transport, remaining):
        name = clip.get("device_name")
        source_id = str(clip.get("id", ""))
        if name not in self.cameras or not source_id.isdecimal() or len(source_id) > 32 or clip.get("deleted"):
            return 0
        try:
            captured = utc_stamp(clip.get("created_at"))
            url = transfer_url(origin, clip.get("media"))
        except (ValueError, AttributeError, TypeError):
            return 0
        key = sha256(f"{account}:{source_id}".encode()).hexdigest()
        media = self.root / (key + ".mp4")
        index = self.root / (key + ".json")
        if index.exists() and media.exists():
            return 0

        maximum = min(remaining, MAX_CLIP)
        part = self.root / (key + ".part")
        meta = self.root / (key + ".pending")
        size = 0
        try:
            async with asyncio.timeout(30):
                async with transport.stream_clip(url, headers) as response:
                    if response.status_code != 200:
                        return 0
                    length = response.headers.get("Content-Length")
                    if length and (not length.isdecimal() or int(length) > maximum):
                        return 0
                    with part.open("wb") as output:
                        async for chunk in response.aiter_content():
                            size += len(chunk)
                            if size > maximum:
                                return 0
                            output.write(chunk)
            with part.open("rb") as source:
                box = source.read(12)
                if len(box) != 12 or box[4:8] != b"ftyp":
                    return 0
            meta.write_text(json.dumps({"camera": name, "createdAt": captured.isoformat()}, ensure_ascii=False))
            part.replace(media)
            meta.replace(index)
            return size
        finally:
            part.unlink(missing_ok=True)
            meta.unlink(missing_ok=True)

    async def sync(self, blink, transport):
        now = datetime.now(timezone.utc)
        used = self.prune(now)
        if used >= self.quota:
            return
        since = now - timedelta(days=min(self.days, 7))
        clips = await blink.get_videos_metadata(since=since.isoformat(), stop=5)
        saved = 0
        attempts = 0
        for clip in clips:
            if not isinstance(clip, dict):
                continue
            try:
                capture = utc_stamp(clip.get("created_at"))
            except (ValueError, AttributeError, TypeError):
                continue
            if capture < since or capture > now + timedelta(minutes=5):
                continue
            # A switch to another provider account keeps old clips in this farm,
            # while the account component prevents record ID collisions.
            try:
                size = await self.save(clip, blink.account_id, blink.urls.base_url, blink.auth.header, transport, self.quota - used)
            except (OSError, TimeoutError) as exc:
                logging.getLogger(__name__).warning("Blink clip transfer interrupted (%s)", type(exc).__name__)
                attempts += 1
                if attempts >= 5:
                    break
                continue
            used += size
            saved += bool(size)
            if used >= self.quota or saved >= 12:
                break


def configured_archive(root):
    # Keep startup compatible with workers that have no archive configuration.
    raw = os.environ.get("BLINK_ARCHIVE_CAMERAS", "")
    if not raw:
        return None
    names = json.loads(raw)
    if not isinstance(names, list) or not 1 <= len(names) <= 32 or any(
        not isinstance(name, str) or not 1 <= len(name) <= 128 for name in names
    ):
        raise ValueError("BLINK_ARCHIVE_CAMERAS must be an array of camera names.")
    days = min(365, max(1, int(os.environ.get("BLINK_ARCHIVE_KEEP_DAYS", "30"))))
    quota = min(20480, max(64, int(os.environ.get("BLINK_ARCHIVE_MAX_MIB", "1024")))) * 1024 * 1024
    return ClipArchive(Path(root), set(names), days, quota)
