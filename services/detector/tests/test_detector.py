import base64
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detector_core import boxes_from, decode_images  # noqa: E402

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 20


class DetectorTests(unittest.TestCase):
    def test_pictures_must_be_one_to_three_jpegs(self):
        self.assertEqual(decode_images([base64.b64encode(JPEG).decode()]), [JPEG])
        with self.assertRaises(ValueError):
            decode_images([])
        with self.assertRaises(ValueError):
            decode_images([base64.b64encode(JPEG).decode()] * 4)
        with self.assertRaises(ValueError):
            decode_images([base64.b64encode(b"\x89PNG....").decode()])
        with self.assertRaises(Exception):
            decode_images(["not base64!"])

    def test_boxes_are_fractions_of_the_picture_best_first(self):
        boxes = boxes_from([[100, 50, 200, 150], [0, 0, 50, 50], [10, 10, 20, 20]], [0.6, 0.9, 0.1], 1000, 500)
        self.assertEqual(boxes, [[0.0, 0.0, 0.05, 0.1, 0.9], [0.1, 0.1, 0.2, 0.3, 0.6]])

    def test_boxes_are_clipped_and_empty_ones_dropped(self):
        self.assertEqual(boxes_from([[-10, -10, 2000, 600]], [0.8], 1000, 500), [[0.0, 0.0, 1.0, 1.0, 0.8]])
        self.assertEqual(boxes_from([[50, 50, 50, 80]], [0.8], 100, 100), [])


if __name__ == "__main__":
    unittest.main()
