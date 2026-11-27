import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "train-bird-detector.py"
spec = importlib.util.spec_from_file_location("train_bird_detector", SCRIPT)
train = importlib.util.module_from_spec(spec)
spec.loader.exec_module(train)


class TrainingTests(unittest.TestCase):
    def test_licences_decide_which_datasets_may_be_used(self):
        self.assertEqual(train.parse_dataset("pio=a.json:imgs", False)[0], "PIO")
        self.assertEqual(train.parse_dataset("FARM=a.json:imgs", False)[0], "FARM")
        with self.assertRaises(SystemExit):
            train.parse_dataset("CHICKENVERSE=a.json:imgs", False)
        self.assertEqual(train.parse_dataset("CHICKENVERSE=a.json:imgs", True)[0], "CHICKENVERSE")
        with self.assertRaises(SystemExit):
            train.parse_dataset("RANDOM=a.json:imgs", True)

    def test_coco_boxes_become_yolo_labels_with_a_held_out_set(self):
        with TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "imgs").mkdir()
            images = []
            for i in range(10):
                (tmp / "imgs" / f"p{i}.jpg").write_bytes(b"\xff\xd8\xff")
                images.append({"id": i, "file_name": f"p{i}.jpg", "width": 200, "height": 100})
            coco = {"images": images, "annotations": [{"image_id": 0, "bbox": [50, 25, 20, 10]}, {"image_id": 0, "bbox": [0, 0, 0, 5]}]}
            (tmp / "a.json").write_text(json.dumps(coco))
            out = tmp / "work" / "PIO"
            trained, held = train.coco_to_yolo(tmp / "a.json", tmp / "imgs", out)
            self.assertEqual((trained, held), (8, 2))
            labels = {p.name: p.read_text() for p in (tmp / "work" / "labels").rglob("*.txt")}
            self.assertEqual(labels["PIO_p0.txt"], "0 0.300000 0.300000 0.100000 0.100000\n", "centre and size as fractions; empty boxes dropped")


if __name__ == "__main__":
    unittest.main()
