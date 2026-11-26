import hashlib
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from zipfile import ZipFile

spec = spec_from_file_location("research", Path(__file__).resolve().parents[1] / "scripts/chickenverse-research.py")
research = module_from_spec(spec)
spec.loader.exec_module(research)


class ChickenVerseResearchTest(TestCase):
    def test_release_inventory_checks_digest_and_excludes_folders(self):
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "ChickenDet.zip"
            with ZipFile(file, "w") as archive:
                archive.writestr("images/", "")
                archive.writestr("images/sample.jpg", "fixture")
                archive.writestr("annotations/sample.json", "{}")
            checksum = hashlib.md5(file.read_bytes(), usedforsecurity=False).hexdigest()
            report = research.inspect_archive(file, checksum)
            self.assertEqual(report, {"archive": "ChickenDet.zip", "imageFiles": 1, "videoFiles": 0, "annotationFiles": 1})
            with self.assertRaises(ValueError):
                research.inspect_archive(file, "0" * 32)

    def test_behavior_scores_and_rejects_mixed_farms(self):
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "predictions.csv"
            header = "clip,held_out_prefix,y_true,y_pred\n"
            rows = "".join(f"F{i:02}_clip,F{i:02},feeding,feeding\n" for i in range(1, 6))
            file.write_text(header + rows, encoding="utf-8")
            self.assertEqual(research.behavior_scores(file)["macroF1"], 1)
            file.write_text(header + rows + "F01_another,F02,feeding,drinking\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                research.behavior_scores(file)


if __name__ == "__main__":
    main()
