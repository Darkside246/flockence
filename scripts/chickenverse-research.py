#!/usr/bin/env python3
"""Prepare a private, aggregate report from the official ChickenVerse research release."""
import argparse
import csv
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

RELEASE = "10.5281/zenodo.20672799"
ARCHIVES = {
    "ChickenDet.zip": "362a97f36a2b592e495d8175447e91e6",
    "ChickenAct.zip": "fa5962dfd9cf99df1b08df613891322c",
}


def inspect_archive(path, checksum):
    with path.open("rb") as archive:
        # Match the release's published integrity checksum.
        digest = hashlib.file_digest(archive, lambda: hashlib.md5(usedforsecurity=False)).hexdigest()
        if digest != checksum:
            raise ValueError(f"{path.name} does not match the official release checksum.")
        archive.seek(0)
        with ZipFile(archive) as content:
            types = Counter(Path(record.filename).suffix.lower() for record in content.infolist() if not record.is_dir())
    return {
        "archive": path.name,
        "imageFiles": sum(types[ext] for ext in (".jpg", ".jpeg", ".png")),
        "videoFiles": types[".mp4"],
        "annotationFiles": types[".json"],
    }


def behavior_scores(path):
    # One unique prediction for each held-out clip. Fold assignment is made
    # when training the model. The CSV must use ChickenAct's release prefixes.
    folds = {f"F{i:02}" for i in range(1, 6)}
    labels, samples, correct, per_fold = set(), set(), 0, Counter()
    actual, predicted, matched = Counter(), Counter(), Counter()
    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            clip, fold, truth, prediction = (row[key].strip() for key in ("clip", "held_out_prefix", "y_true", "y_pred"))
            if fold not in folds or not Path(clip).name.startswith(fold + "_") or clip in samples or not truth or not prediction:
                raise ValueError("Expected one prediction per clip with a matching held-out farm prefix.")
            labels.update((truth, prediction))
            samples.add(clip)
            per_fold[fold] += 1
            actual[truth] += 1
            predicted[prediction] += 1
            if truth == prediction:
                correct += 1
                matched[truth] += 1
    if set(per_fold) != folds:
        raise ValueError("The behavior evaluation requires predictions for all five held-out farms.")
    return {
        "clips": len(samples),
        "accuracy": round(correct / len(samples), 4),
        "macroF1": round(sum(2 * matched[label] / (actual[label] + predicted[label]) for label in labels) / len(labels), 4),
        "foldClips": dict(sorted(per_fold.items())),
    }


def coco_scores(annotations, predictions, task):
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval

    target = COCO(str(annotations))
    results = target.loadRes(str(predictions))
    test = COCOeval(target, results, task)
    test.evaluate()
    test.accumulate()
    test.summarize()
    return {"averagePrecision": round(float(test.stats[0]), 4), "images": len(target.getImgIds())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, required=True, help="Directory with both official ZIP downloads")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--behavior-predictions", type=Path)
    parser.add_argument("--detection", type=Path, nargs=2, metavar=("TEST_ANNOTATIONS", "PREDICTIONS"))
    parser.add_argument("--segmentation", type=Path, nargs=2, metavar=("TEST_ANNOTATIONS", "PREDICTIONS"))
    args = parser.parse_args()
    try:
        result = {
            "version": 1,
            "release": RELEASE,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "archives": [inspect_archive(args.dataset_dir / name, digest) for name, digest in ARCHIVES.items()],
        }
        if args.behavior_predictions:
            result["behavior"] = behavior_scores(args.behavior_predictions)
        if args.detection:
            result["detection"] = coco_scores(*args.detection, task="bbox")
        if args.segmentation:
            result["segmentation"] = coco_scores(*args.segmentation, task="segm")
        with args.report.open("x", encoding="utf-8") as target:
            json.dump(result, target, indent=2)
            target.write("\n")
    except (OSError, ValueError, KeyError, ImportError) as error:
        parser.exit(1, f"ChickenVerse report could not be generated: {error}\n")


if __name__ == "__main__":
    main()
