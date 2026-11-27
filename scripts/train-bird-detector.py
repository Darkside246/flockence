#!/usr/bin/env python3
"""Train the Flockence bird counter (services/detector) from COCO-format datasets. Run on the detector machine.

  python3 scripts/train-bird-detector.py --out runs/birds \
      --dataset PIO=/data/pio/annotations.json:/data/pio/images \
      --dataset FARM=/data/farm/labels.json:/data/farm/images \
      --epochs 80

Each --dataset is NAME=annotations.json:images_folder. Licences decide what may be used for a model Flockence ships:
  PIO           CC BY 4.0: allowed, with credit
  FARM          the owner's own labelled pictures: allowed
  CHICKENVERSE  CC BY-NC-SA 4.0: only with --chickenverse-commercial-licence (the owner's commercial licence)
Other names are refused. The script converts the boxes to YOLO format (one class: bird), keeps a held-out set from each
dataset (by image, seeded), trains with ultralytics YOLO, and writes the weights and a report with the dataset credits.
Set DETECTOR_WEIGHTS to the best weights on the detector machine.
"""
import argparse
import json
import random
import shutil
import sys
from pathlib import Path

ALLOWED = {"PIO": "CC BY 4.0 (credit the PIO authors)", "FARM": "The farm's own labelled pictures"}
NEEDS_LICENCE = {"CHICKENVERSE": "CC BY-NC-SA 4.0; used under the owner's commercial licence"}


def coco_to_yolo(annotations, images_dir, out_dir, split_seed=42, holdout=0.15):
    """Write YOLO label files and image links for one COCO dataset. Returns (train, val) image counts."""
    data = json.loads(Path(annotations).read_text(encoding="utf-8"))
    by_image = {}
    for a in data.get("annotations", []):
        by_image.setdefault(a["image_id"], []).append(a["bbox"])
    images = sorted(data.get("images", []), key=lambda i: str(i["file_name"]))
    random.Random(split_seed).shuffle(images)
    cut = int(len(images) * (1 - holdout))
    counts = {"train": 0, "val": 0}
    for n, image in enumerate(images):
        split = "train" if n < cut else "val"
        src = Path(images_dir) / Path(image["file_name"]).name
        if not src.is_file() or src.is_symlink():
            continue
        w, h = image["width"], image["height"]
        lines = []
        for x, y, bw, bh in by_image.get(image["id"], []):
            if bw > 0 and bh > 0:
                lines.append(f"0 {(x + bw / 2) / w:.6f} {(y + bh / 2) / h:.6f} {bw / w:.6f} {bh / h:.6f}")
        name = f"{out_dir.name}_{src.stem}"
        (out_dir.parent / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir.parent / "labels" / split).mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, out_dir.parent / "images" / split / (name + src.suffix.lower()))
        (out_dir.parent / "labels" / split / (name + ".txt")).write_text("\n".join(lines) + "\n", encoding="utf-8")
        counts[split] += 1
    return counts["train"], counts["val"]


def parse_dataset(text, chickenverse_ok):
    name, _, paths = text.partition("=")
    annotations, _, images = paths.partition(":")
    name = name.strip().upper()
    if name in NEEDS_LICENCE and not chickenverse_ok:
        raise SystemExit(f"{name} is {NEEDS_LICENCE[name].split(';')[0]}: pass --chickenverse-commercial-licence only once the commercial licence is in place.")
    if name not in ALLOWED and name not in NEEDS_LICENCE:
        raise SystemExit(f"Unknown dataset {name}. Use PIO, FARM or CHICKENVERSE.")
    if not annotations or not images:
        raise SystemExit("Each --dataset is NAME=annotations.json:images_folder")
    return name, Path(annotations), Path(images)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset", action="append", required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--model", default="yolo11s.pt", help="starting weights (ultralytics)")
    p.add_argument("--imgsz", type=int, default=1280, help="birds are small: train at high resolution")
    p.add_argument("--chickenverse-commercial-licence", action="store_true")
    args = p.parse_args()
    work = args.out / "data"
    if work.exists():
        raise SystemExit(f"{work} already exists; choose a new --out.")
    credits = []
    for text in args.dataset:
        name, annotations, images = parse_dataset(text, args.chickenverse_commercial_licence)
        train, val = coco_to_yolo(annotations, images, work / name)
        credits.append({"dataset": name, "licence": ALLOWED.get(name) or NEEDS_LICENCE[name], "train": train, "val": val})
        print(f"{name}: {train} training and {val} held-out pictures")
    (work / "birds.yaml").write_text(f"path: {work.resolve()}\ntrain: images/train\nval: images/val\nnames:\n  0: bird\n", encoding="utf-8")
    from ultralytics import YOLO  # on the detector machine only
    model = YOLO(args.model)
    model.train(data=str(work / "birds.yaml"), epochs=args.epochs, imgsz=args.imgsz, project=str(args.out), name="train", exist_ok=False)
    metrics = model.val()
    report = {"datasets": credits, "mAP50": float(metrics.box.map50), "mAP50_95": float(metrics.box.map), "weights": str(args.out / "train" / "weights" / "best.pt")}
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    sys.exit(main())
