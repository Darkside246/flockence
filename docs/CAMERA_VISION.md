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

## Automatic inspections (2026-11-27)

Farm Vision can check the cameras by itself. On **https://flockence.com/vision**, an owner or manager uses
**Automatic inspections**:
- one switch, which includes every camera that has a pen
- per camera: how often (every hour to once a day) and the type (a short live video, or a single picture, which uses
  less battery)
- under **More options**: quiet hours (default 19:00–05:30), the most checks a day (default 24) and how long automatic
  pictures are kept (default 30 days)

**What happens each round** (a server timer every 10 minutes):
- Only farms that switched this on, with Premium and cameras enabled, are checked. Quiet hours are skipped, and one
  round runs per farm at a time.
- Due cameras are checked most overdue first: at most 4 per round, within the daily limit.
- Each camera must be assigned to a pen. The live sample is the same one the "Check my flock" button takes (three
  ordered frames), with the same pen checks.
- The model is told the flock in that pen (the flock placed in the pen, or the farm's only active flock): its age,
  breed, recorded live birds, deaths in the last day and week, the latest daily check (temperature, humidity,
  ammonia, litter, panting) and the local time.
- It returns its usual findings, plus an approximate count of the birds in view (never the flock total) and up to
  three questions when it is not sure.
- The result is saved as a health observation ("Farm Vision automatic inspection"). It appears in Vision history
  and in "Today on your farm" on the dashboard, problems first.
- **Oriya:** when the farm is linked to Oriya and the camera is one it shares (`ORIYA_CAMERAS`), the same frames go to
  Oriya's `flock-snapshots` link. The camera is not woken twice. Oriya's count and alerts come back as health
  observations, and Oriya sends the WhatsApp message when its `FLOCK_ALERTS_WHATSAPP` is on. No camera name or
  address is sent.
- **Failures:** after 3 in a row, the camera shows "Needs attention" with the reason.
- **Clean-up:** automatic pictures older than the keep-days are deleted. Their written results stay. Manual
  inspections are never deleted.

**Server setup, once, after deploying:**

```bash
sudo bash "$(systemctl show flockence.service -p WorkingDirectory --value)/ops/systemd/enable-vision-rounds.sh" --cameras-on
```

The script:
- creates `VISION_ROUNDS_TOKEN` in the app's `.env`, after backing the file up
- switches on `FLOCKENCE_CAMERA_VISION` and `FLOCKENCE_LIVE_CAMERA_VISION` (with `--cameras-on`)
- restarts Flockence only when `.env` changed
- installs `flockence-vision-rounds.timer` and runs one round

The timer always uses the live release directory, so a release switch needs no change. To stop it:
`sudo systemctl disable --now flockence-vision-rounds.timer`. Analysis needs `OPENAI_API_KEY`.

**Cost:** each check is one model request and wakes a Blink camera. The page shows the expected checks per day.

## Choosing the vision model, and plan limits (2026-11-27)

### Which AI looks at the pictures

`lib/vision-provider.ts` sends every inspection (manual and automatic) to one provider. Switching changes cost and
quality only: every provider gets the same prompt and pictures, and its answer is checked against the same schema.

| Setting | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Uses Claude directly (the default when this key is set). |
| `OPENROUTER_API_KEY` | Uses OpenRouter: one key and one bill for many companies' models. The default model is `anthropic/claude-haiku-5.5`; any OpenRouter model id with image input works in `VISION_MODEL`, for example `anthropic/claude-sonnet-5.5`. OpenRouter reports what each request cost, and that charged amount is what Flockence records. Out of credits shows as "The OpenRouter account is out of credits". |
| `OPENAI_API_KEY` | Uses OpenAI, when no Claude key is set or `VISION_PROVIDER=openai`. |
| `VISION_PROVIDER` | `anthropic`, `openrouter` or `openai`, to choose explicitly. Otherwise the first key set is used, in that order. |
| `VISION_MODEL` | The routine model. Empty means `claude-haiku-5-5` (Anthropic), `anthropic/claude-haiku-5.5` (OpenRouter) or `gpt-5.6-luna` (OpenAI). A name in the wrong form for the chosen provider is ignored. |
| `VISION_EFFORT` | Claude and OpenRouter: `low` (default), `medium` or `high`. Routine farm pictures need little reasoning. |
| `VISION_ESCALATE_MODEL` | Optional, same provider, for example `claude-sonnet-5-5`. Only pictures the routine model rated high, urgent or "escalate" are looked at again by this model, and its answer is kept. Off unless set. |
| `VISION_PRICES` | Optional JSON `{"model": [input $, output $ per million tokens]}`, for a model not in the built-in list or a changed price. |

Built-in list prices, US dollars per million tokens (input / output):
- `claude-haiku-5-5`: 0.10 / 0.50
- `claude-sonnet-5-5`: 2 / 10
- `claude-opus-5-5`: 4 / 20

A typical inspection (three 512-pixel frames, the farm context, the answer and its reasoning) is about 2,500 tokens
in and 1,500 out. That is roughly $0.001 on Claude Haiku 5.5 and $0.02 on Claude Sonnet 5.5. Check the real
figures: every call's tokens and cost are recorded per farm per month (`VISION_USAGE::YYYY-MM`) and shown on the Farm
Vision page.

Before choosing a model for good, compare it on 20–30 saved pictures (good, problem and dark ones), and pick the
cheapest one whose counts and findings hold up.

### Plan limits

The plan follows the farm's membership:
- **Free** farms are Free.
- **Premium** farms are Premium.
- Farms from before Premium was enforced count as **Standard**.
- Farms listed in `VISION_PREMIUM_FARMS` (comma-separated farm ids, for example the owner's own `default-farm`) get Premium vision limits.

| Plan | Automatic checks | Cameras | Most often | Automatic checks a day | Manual inspections a month | Monthly vision budget |
| --- | --- | --- | --- | --- | --- | --- |
| Free | no | 0 | – | 0 | 0 | $0 |
| Standard | yes | 1 | every 6 hours | 3 | 30 | $1 |
| Premium | yes | 8 | every hour | 24 | 300 | $10 |

Change any number without code, for example `VISION_PLAN_LIMITS='{"STANDARD":{"dailyCap":4},"PREMIUM":{"monthlyBudgetUsd":20}}'`.

The limits are enforced on the server in three places:
- **Saving a schedule:** over the plan is refused in plain words, and the daily cap is lowered to fit.
- **Every automatic round:** the saved schedule is cut down to the plan, and rounds stop for the month once the farm's
  vision cost reaches its budget.
- **Every "Check my flock":** the monthly allowance of manual inspections applies.

The Farm Vision page shows the plan, what it includes, and the month's use.

## Photos from phones (2026-11-27)

- **Smaller uploads.** The phone shrinks a photo to 2576 px on the long side (the most current Claude vision models
  see) as a quality-0.9 JPEG before sending (`lib/photo-shrink.ts`, `lib/photo-size.mjs`).
- **Answer at once, check in the background.** The page sends `Prefer: respond-async` and an `Idempotency-Key`. The
  server reads the photo, answers 202 straight away and runs the check; the phone asks
  `GET /api/vision/status?id=…` every few seconds. Leaving the page is fine: the result is saved to the history.
- **Never twice.** A retry with the same id shares the running check or gets the saved one, so a photo is analysed,
  saved and charged once (`lib/vision-upload-requests.ts`). Finished replies are kept in the service for an hour. If
  the service restarts mid-check, the status is "unknown" and the phone sends the photo again; nothing was saved.
- **No signal.** A photo (not a live camera check) taken with no signal is kept on the phone in IndexedDB
  (`flockence-vision-queue`, per user and farm, dropped after 7 days) and sent with the same id when the phone is back
  online or the Farm Vision page is opened. Shown as "N photos saved on this phone" with a Send now button.
- Saved photos are also sent with Flockence closed, as soon as the signal returns: the service worker handles a
  Background Sync (`public/sw.js`, `public/vision-sync.js`) on Android and Chrome. iPhones do not support it, so there
  they go when Flockence is next opened. A photo is only sent while the person who took it is signed in.

## Daily email report (Vision Intelligence phase 1c, 2026-11-27)

- Once a day, each farm's owners and managers who ticked **Farm reports** on their Account page get an email with the
  last 24 hours: the overall condition, what to do first, areas needing attention, areas not seen, their flock records
  (age, live count, deaths, feed) and what the cameras covered, with a link to Cameras → Vision.
- Every plan, Free included. Settings are in Cameras → Vision → Daily email report: on or off (default on) and the
  hour, farm time (default 07:00, America/Barbados for all farms today).
- It is sent by the automatic camera round (`flockence-vision-rounds.timer`, every 10 minutes), from the chosen hour
  until the end of the farm's day. No extra set-up beyond that timer and Resend (`RESEND_API_KEY`, `RESEND_FROM`).
- Each person gets it at most once a day: who has been sent is recorded per farm and day
  (`VISION_DAILY_REPORT_STATE`), and Resend's Idempotency-Key covers a crash between sending and recording. A failed
  send is retried on the next round, for that person only. A missed day is never sent late.
- A day with no pictures and nothing open sends nothing.
- Code: `lib/vision-daily-report.ts`, `lib/vision-daily-report-rules.mjs`, `app/api/vision/daily-report`,
  `components/vision-daily-report.tsx`.

## Alerts (Vision Intelligence phase 1c, 2026-11-27)

- After an inspection records its findings, serious ones (HIGH and CRITICAL) are emailed straight away to owners and
  managers who ticked **Farm alerts** on their Account page. The rest wait for the daily report.
- Grouped by incident (the 48-hour finding groups): one problem seen in many pictures is one alert. It is sent again
  only when it gets worse (HIGH to CRITICAL), or as a reminder if it is still seen after its cooldown (CRITICAL 4 hours,
  HIGH 12 hours), at most twice. One inspection's alerts go in one email.
- At most 6 alert emails per farm per hour; more are held and shown in the daily report.
- If no email could be sent, the alert is tried again by the next inspection that sees the problem.
- Cameras → Vision shows the last alerts and who gets alert emails, so alerts are visible without email.
- Oriya / WhatsApp: automatic checks of cameras shared with Oriya (`ORIYA_CAMERAS`) already go to Oriya, which sends its
  own WhatsApp alerts. Sending these Vision alerts to Oriya needs a new message type on Oriya's side (Phase 7).
- Code: `lib/vision-alert-rules.mjs`, `lib/vision-alerts.ts`, `app/api/vision/alerts`, `components/vision-alerts.tsx`.

## Free farms (2026-11-27)

- Free farms get photo checks by hand (10 a month by default; `VISION_PLAN_LIMITS='{"FREE":{"manualPerMonth":N}}'`),
  findings, reports, the pen timeline, alerts and the daily email. Camera checks, the automatic schedule and the camera
  pages stay Premium.
- The Farm Vision page (now in the menu, under Control) shows the reports for every plan and how many photo checks are
  left this month. The daily email links there (`/vision#reports`).

## Pen layout advice (Vision Intelligence plan section 5, 2026-11-27)

- The Farm Vision page has a **Pen layout** section for each pen: floor area and stocking density (from the pen's saved
  size, the flock's live birds and its latest live weight), feeders, drinkers and heaters recorded against what the
  cameras saw, and ranked changes, each naming its guidance (Ross, Cobb, or the cameras over the last 7 days).
- Vision now reports, for pen pictures, how much of the pen is in view, the feeders, drinkers, heaters and fans it can
  count, where birds crowd and which areas they avoid (`layout` in the answer and in the saved assessment).
- Equipment counts from the cameras are used only from pictures that show (most of) the pen; one crowded picture is not
  treated as a layout problem (it must repeat). Vision never measures the pen from pictures and never changes the
  records; the size comes from the Pens page or farm setup.
- Code: `lib/pen-layout-rules.mjs`, `lib/pen-layout.ts`, `app/api/vision/layout`, `components/pen-layout.tsx`.
