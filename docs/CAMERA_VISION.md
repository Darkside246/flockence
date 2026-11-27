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

## Assign a farm camera to a pen

In Farm Vision, an authorized owner or manager can choose a connected camera,
select a pen and save the camera assignment. Future inspections use the
assignment even when the request omits the pen. Remove or change the mapping
when a camera moves. Prior inspections retain the pen recorded at the time.

Updated Blink workers supply a device fingerprint that survives a camera
rename. Older workers and locally configured network sources use the
configured camera name. Check and reassign those mappings after a rename or
replacement. Farm identity comes from the session, and assignment changes
are recorded in the farm audit log.


## Sample live video from an assigned camera

On the VPS, deploy the application and the matching private Blink or network-camera worker together. Set `FLOCKENCE_CAMERA_VISION=on` and `FLOCKENCE_LIVE_CAMERA_VISION=on` in the application environment. Farm Vision also needs its server-side model key and a plan and account that allow image analysis.

1. Open **Cameras** and verify Live View plays for the device. Then select that camera in **Farm Vision** and save its pen assignment.
2. Select **Short live video sample**, review the image-sharing consent, and run the inspection. The worker starts a stream as needed and samples three ordered frames from distinct segments. If Live View is already running, the worker samples new segments while leaving that stream available.
3. Verify that Vision history shows the assigned pen and labels the entry as a video sample. Repeat the inspection with the same camera and compare the two results. A comparison requires the same pen, camera and capture mode.

The model receives three JPEG frames. The app retains one private preview and the structured inspection. It does not retain the sampled video. Samples report what is visible and can miss activity between frames. Scheduled video jobs, persistent bird tracks, and validated scores need further implementation and field testing. Keep sampling disabled until a real camera passes the steps above.

## Recordings screen (2026-11-27)

- **Layout:** Cameras, Recordings shows each clip as a small thumbnail, about 2 x 1.5 inches (192 x 144 CSS pixels) on a computer and two per row on a phone.
- **Player:** the chosen clip plays in a player pinned under the top bar while the list scrolls. It has Previous, Next and Close, and an optional "play the next clip automatically" (remembered on that device).
- **Styles:** `app/camera-recordings.css`.
- **Vision:** Farm Vision does not read recorded clips. It analyses a fresh still from a camera, or three ordered frames sampled from live video (`captureVisionVideoSample`). Analysing a recorded clip would be a separate feature.
