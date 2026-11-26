import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clip_archive import ClipArchive, transfer_url


class ArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_copies_only_opted_in_clips_once_and_enforces_retention(self):
        now = datetime.now(timezone.utc)
        item = {"device_name": "Pen 1", "created_at": now.isoformat(), "id": 123, "media": "/api/v1/clips/123"}

        async def listing(**kwargs):
            return [
                {**item, "id": 234, "device_name": "Pen 2"},
                {**item, "id": 345, "media": "https://example.com/api/345"},
                {**item, "id": 456, "created_at": (now - timedelta(days=9)).isoformat()},
                item,
            ]

        async def content():
            yield b"\x00\x00\x00\x0cftypmp42"

        fetched = []

        @asynccontextmanager
        async def stream(url, headers):
            fetched.append(url)
            yield SimpleNamespace(status_code=200, headers={}, aiter_content=content)

        blink = SimpleNamespace(account_id=1, urls=SimpleNamespace(base_url="https://rest.immedia-semi.com"),
                                auth=SimpleNamespace(header={}), get_videos_metadata=listing)
        with TemporaryDirectory() as directory:
            archive = ClipArchive(Path(directory), {"Pen 1"}, days=8)
            transport = SimpleNamespace(stream_clip=stream)
            await archive.sync(blink, transport)
            await archive.sync(blink, transport)
            self.assertEqual(fetched, ["https://rest.immedia-semi.com/api/v1/clips/123"])
            rows = archive.rows()
            self.assertEqual([row["camera"] for row in rows], ["Pen 1"])
            self.assertEqual(archive.path(rows[0]["id"]).read_bytes(), b"\x00\x00\x00\x0cftypmp42")
            archive.prune(now + timedelta(days=10))
            self.assertEqual(archive.rows(), [])
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_clip_origins_and_paths_are_restricted(self):
        with self.assertRaises(ValueError):
            transfer_url("https://example.com", "/api/v1/clips/123")
        with self.assertRaises(ValueError):
            transfer_url("https://rest.immedia-semi.com", "/api/../abc")
        with self.assertRaises(ValueError):
            transfer_url("https://rest.immedia-semi.com:81", "/api/v1/clips/123")
