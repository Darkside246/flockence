from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clip_frames import blink_path, local_clip, parse_duration, sample_times


class ClipFrameTests(unittest.TestCase):
    def test_duration_from_ffmpeg(self):
        self.assertEqual(parse_duration("  Duration: 00:00:30.04, start: 0.000000, bitrate: 900 kb/s"), 30.04)
        self.assertEqual(parse_duration("Duration: 01:02:03.5"), 3723.5)
        self.assertIsNone(parse_duration("Duration: N/A"))
        self.assertIsNone(parse_duration(""))

    def test_three_points_through_the_clip(self):
        self.assertEqual(sample_times(30.0), [3.0, 15.0, 27.0])
        self.assertEqual(sample_times(1.0), [0.0])
        self.assertEqual(sample_times(None), [0.0])

    def test_only_blink_api_paths(self):
        self.assertEqual(blink_path("/api/v2/accounts/1/media/clip/abc.mp4"), "/api/v2/accounts/1/media/clip/abc.mp4")
        self.assertIsNone(blink_path("https://evil.example/api/x"))
        self.assertIsNone(blink_path("/api/../../etc/passwd"))
        self.assertIsNone(blink_path("/etc/passwd"))
        self.assertIsNone(blink_path(None))

    def test_only_files_inside_the_recordings_folder(self):
        with TemporaryDirectory() as tmp:
            rec = Path(tmp) / "recordings"
            (rec / "pen_1").mkdir(parents=True)
            clip = rec / "pen_1" / "20261127-061500.mp4"
            clip.write_bytes(b"\x00")
            self.assertEqual(local_clip("rtsp", "recordings/pen_1/20261127-061500.mp4", rec, None), clip)
            self.assertIsNone(local_clip("rtsp", "recordings/pen_1/../../secret.mp4", rec, None))
            self.assertIsNone(local_clip("rtsp", "recordings/pen_1/20261127-999999.mp4", rec, None))
            self.assertIsNone(local_clip("rtsp", "/etc/passwd", rec, None))
            self.assertIsNone(local_clip("other", "recordings/pen_1/20261127-061500.mp4", rec, None))

    def test_archive_clips_through_the_archive(self):
        with TemporaryDirectory() as tmp:
            media = Path(tmp) / "abc123.mp4"
            media.write_bytes(b"\x00")

            def path(key):
                if key != "abc123":
                    raise FileNotFoundError(key)
                return media

            self.assertEqual(local_clip("archive", "archives/abc123.mp4", tmp, path), media)
            self.assertIsNone(local_clip("archive", "archives/missing.mp4", tmp, path))
            self.assertIsNone(local_clip("archive", "archives/../x.mp4", tmp, path))


if __name__ == "__main__":
    unittest.main()
