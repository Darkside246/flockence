# Camera inspections in Farm Vision

Set `FLOCKENCE_CAMERA_VISION=on` in the Flockence service environment
after verifying the correct farm camera worker. Configure the existing
`OPENAI_API_KEY` and a vision-capable `VISION_MODEL`. In Farm Vision,
an owner or manager with camera access can select a Blink or network
camera from that farm, authorize sending one image, and request an
inspection. Leave the option disabled to keep the existing upload flow.
This path uses the same private farm-scoped worker as the Cameras page.
Camera addresses and vendor credentials stay with that worker.

The inspection asks for a new snapshot and stores the findings and
requested camera name in the farm's health history. The configured
vision provider receives the image and any inspection context entered
by the user. Use camera angles that avoid people and sensitive areas.
Camera images are kept in the private vision media storage for
authorized farm accounts.

[ChickenVerse](https://github.com/amirivojdan/ChickenVerse) describes
ChickenDet for detection and segmentation, and ChickenAct for behavior
recognition. Its dataset is released under CC BY-NC-SA 4.0. The normal camera inspection path uses Flockence's existing image
analysis provider. The research tools below consume only official
research downloads and locally generated predictions.

## Test ChickenVerse in Flockence

Use a separate noncommercial research deployment and private data directory
on the VPS. Download both ZIP files from the versioned Zenodo record. The
release is about 5.9 GB. Generate the aggregate report as the service user
with a restrictive file creation mask.

```bash
umask 077
python3 scripts/chickenverse-research.py --dataset-dir /path/to/private/chickenverse --report /path/to/private/chickenverse/report.json
```

The script matches both archives against Zenodo's published checksums
and inventories the files without extracting them. For metrics, train or
run the upstream models in a separate research process. Pass the held-out
COCO annotations and model predictions using `--detection` and
`--segmentation` (requires `pycocotools`). For behavior, pass
`--behavior-predictions` with columns `clip,held_out_prefix,y_true,y_pred`
covering the five held-out farms. The evaluator checks prefix consistency,
unique clips and fold coverage. Keep train/test separation in the model
training process. The published behavior pipeline tracks birds to form
individual clips. Its behavior annotations alone do not supply trajectories
for scoring live tracking.

Set `CHICKENVERSE_RESEARCH=on`, `CHICKENVERSE_RESEARCH_FARM_ID` to the
research farm ID, and `CHICKENVERSE_RESEARCH_REPORT` to the private JSON file.
The configured research farm owner can view the aggregate report in Farm
Vision. This report path is separate from camera capture and never reads
customer camera footage, camera tokens, or production records.
