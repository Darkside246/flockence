import asyncio
import base64
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "blink"))
from video_sample import playlist_segments, sample_live_playlist


class VideoSampleTest(unittest.TestCase):
    def test_playlist_ignores_unsafe_entries_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            playlist = Path(directory) / "index.m3u8"
            playlist.write_text("#EXTM3U\ncam_02.ts\n../other.ts\nhttps://test/other.ts\n"
                                "cam_01.ts\ncam_02.ts\nnot-video.jpg\n")
            self.assertEqual(playlist_segments(playlist), ["cam_02.ts", "cam_01.ts"])
            playlist.write_text("#EXTM3U\n" + "X" * 16384 + "\ncam_02.ts")
            self.assertEqual(playlist_segments(playlist), [])

    def test_extracts_ordered_frames_from_three_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            names = []
            for color in ("red", "blue", "green"):
                name = color + ".ts"
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                                "-i", f"color={color}:s=96x64:r=10", "-t", "1",
                                "-c:v", "mpeg2video", "-f", "mpegts", str(root / name)],
                               check=True, timeout=10)
                names.append(name)
            playlist = root / "index.m3u8"
            playlist.write_text("#EXTM3U\n" + "\n".join(names))
            frames = asyncio.run(sample_live_playlist(playlist, "ffmpeg"))
            self.assertEqual(len(frames), 3)
            self.assertEqual(len(set(frames)), 3)
            for frame in frames:
                self.assertTrue(base64.b64decode(frame).startswith(b"\xff\xd8\xff"))
            playlist.write_text("#EXTM3U\n" + "\n".join(reversed(names)))
            self.assertEqual(asyncio.run(sample_live_playlist(playlist, "ffmpeg")), frames[::-1])


if __name__ == "__main__":
    unittest.main()
