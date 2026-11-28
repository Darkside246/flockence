# Flockence Vision Intelligence: inspection and phased plan (2026-11-27)

The owner's brief asks for a full poultry vision intelligence system in the Camera tab. It covers farm, pen, batch and
camera reports, age-aware welfare monitoring, possible dead birds, litter, heat and cold, feed and water, eggs, people
in pens, history and trends, alerts, daily email, Oriya/WhatsApp delivery, evidence and validation. It adds "tell the
pen size from images and recommend a layout". This document does what the brief asks first: it maps the brief onto
what Flockence already has, says what can be built now and what needs new infrastructure, and sets the order.

## 1. What already exists (source of truth for each kind of data)

| Area | Where it lives today | Reuse for Vision |
| --- | --- | --- |
| Cameras | Private camera workers per farm (`services/blink`, `lib/blink-sidecar.ts`); Blink, network (RTSP) and Wyze bridge sources; live HLS, snapshots | Frame source for every analysis |
| Recordings | Worker `/clips` and `/archives` (Blink cloud clips copied privately, `BLINK_ARCHIVE_CAMERAS`, 30-day retention); imported clips; Cameras → Recordings | Recorded footage to sample (not yet read by Vision) |
| Photos and evidence | `VisionMedia` and `HealthObservation.visionAssessment` (versioned), private storage `/var/lib/flockence/vision` | Finding evidence; the start of the media index |
| Camera to pen | `VISION_CAMERA_PEN::` setting, one pen per camera, audited, **current only** | Needs history (dated mapping) and many-to-many |
| Pens | `PEN::`/`PENCFG::` settings; farm setup stores pen **length, width, capacity** (`lib/farm-setup.ts`) | Pen size for stocking density and layout |
| Housing guidance | `lib/house-advisor.ts`: stocking kg/m² (Ross 2025), feeder pans (Cobb 2021), water, airflow | Layout and density recommendations |
| Batches | `Batch` (placement, hatch, breed, production type, placementHouse), `lib/flock-ledger.ts` (expected live birds from placements, additions, moves, deaths, culls, missing, slaughter) | Age and expected live population |
| Mortality | `MortalityEvent` (died, culled, missing, corrections, audit) | Reconciliation; never written by Vision |
| Feed and water | `FeedUsage` (kg, eaten vs put out), `WaterReading` (meters/tanks), daily checks | Consumption trends |
| Eggs | `EggCollection` (total, saleable, dirty, cracked, broken, floor, household, hatching) | Floor-egg reconciliation |
| Environment | `ThermometerReading`, daily check temperature, humidity, ammonia, litter, panting and wing spreading | Heat and cold correlation |
| Vision today | Manual and timed inspections (3 live frames or a still), farm context, poultry checklist, earlier-picture still-bird check, per-farm cost and plan limits, provider choice (OpenRouter on flockence.com) | The analysis step to grow |
| Jobs | systemd timers on the VPS (`flockence-vision-rounds.timer`, devices timer); no general queue | Extend with a job table and the timer |
| Email | `lib/mail.ts` (Resend) | Daily report email |
| Oriya | Signed links: flock-checks, flock-snapshots (Oriya counts birds and sends WhatsApp when `FLOCK_ALERTS_WHATSAPP` is on), pen-report pull, camera-frames | WhatsApp route, with no second sender |
| Security | Farm scope, row security scripts, audited settings, plans (`lib/farm-feature-access.ts`, vision plans) | Every new table follows the same rules |

Not found:
- a media index across clips, archives and photos
- dated camera-to-pen history
- finding or incident records with farmer review
- report records
- people-in-pen events
- a vision job queue
- any trained detector

## 2. What is realistic, and what each part needs

| Brief item | Can be built on what exists | Needs new infrastructure |
| --- | --- | --- |
| Farm, pen, batch and camera reports with scope, date range and coverage disclosure | Yes. They combine inspections, records and reconciliation. | – |
| Age-aware context (stages, breed, strain, placement date, never assume 42 days) | Yes (`lib/vision-context.ts` already uses the real age) | Stage rules table |
| Population reconciliation (expected 116, about 108 visible: an investigation, never a change) | Yes (`flock-ledger.ts` plus the visible count) | – |
| Possible dead or down birds over time | Partly: the earlier-picture comparison works now | Reliable tracking needs a bird detector |
| Behaviour, heat and cold, litter, feed and water from pictures | Yes, as model observations with confidence, correlated with sensors and records | Measured accuracy needs a labelled set |
| Accurate bird counts and tracking | No: a general model estimates | A trained detector (PIO CC BY 4.0 plus farm pictures) |
| Floor eggs, nest use | Observations only | A trained egg detector and suitable cameras |
| People in pens (timeline, no identity) | Possible from sampled frames | Reliable entry and exit needs more frequent frames |
| Pen size from images | **Only with a known measurement in view** | See section 5 |
| Daily email report (Free: one a day) | Yes (Resend, timer, idempotency) | – |
| WhatsApp through Oriya Operator Mode | Alerts already flow (flock-snapshots) | A daily-report message type on Oriya's side (an Oriya change, outside this repository) |
| Findings with Observed / Suspected / Requires inspection / Confirmed / Dismissed / Resolved / Inconclusive | Yes (new table) | – |
| Pen condition history (Day 1 … Day 21 timeline) | Yes, from findings and inspections | – |
| Validation (precision, recall, count error, false alerts) | Evaluation harness | The owner's labelled pictures; dataset licences |

**Compute.** The VPS has 2 CPUs and 4 GB of memory. It can run a small CPU detector (for example a YOLO-nano model
through ONNX Runtime) on sampled frames, a few a minute, which is enough for sampled monitoring. It cannot process
hours of video. Continuous video would need a GPU machine or an edge box on the farm. The plan therefore samples
frames on purpose, and the reports say how much footage was actually analysed.

## 3. Phases (each one shipped, tested and deployed before the next)

**Phase 1: findings, reports and the daily email** (no new AI model)
- Tables, all additive SQL with farm scope and row security:
  - `VisionFinding`: kind, pen, batch, camera, time span, evidence, confidence, severity, state and its history
  - `VisionReport`: scope, period, coverage, content
  - `CameraPenLink`: dated camera-to-pen history, many-to-many, optional zone
- Every inspection writes findings:
  - possible dead or down bird
  - heat or cold behaviour
  - litter
  - feed or water access
  - equipment
  - population discrepancy (expected versus visible, with coverage)
- The farmer confirms, dismisses or resolves each finding. The original is kept. Nothing changes official records.
- Report scopes (farm, pen, batch, camera, several cameras; today, 24 hours, 7 days, 30 days, custom, the batch's
  whole history). Each report contains:
  - the executive summary
  - status per area (birds, litter, thermal, feed and water, population, eggs, equipment)
  - camera coverage and what was missing
  - changes against earlier days
  - ranked actions, evidence and limitations
  - "Insufficient data" whenever coverage is thin
- A pen condition timeline across the batch.
- The Camera tab gets a Vision view: farm overview, alerts, pen cards, the timeline and reports. The Farm Vision page
  stays as the place to run checks.
- Daily email report at the farm's chosen local time, once a day, retry-safe. Free farms get one full daily report,
  per the brief; this replaces the earlier "Free: none" plan limit.
- Alerts grouped into incidents with a cooldown, sent to Oriya through the existing signed link.

**Phase 2: measured accuracy and a bird detector**
- The evaluation set: the owner's labelled pictures plus licensed datasets.
- Measure the current model: count error, dead birds found and missed, false alarms, cost.
- A CPU bird detector on the VPS for visible counts, positions and still-bird tracking across samples. The general
  model keeps describing the pen.

- **Built (28 Nov 2026):** Farm Vision → Accuracy. Owners and supervisors label recent checks with the birds really in view, dead or down birds and floor eggs. The tab shows:
  - the average count miss for Farm Vision and the bird counter
  - dead birds found, dead birds missed, and false alarms
  - how many reviewed dead-bird alerts were real
  - a CSV of the labelled set, for evaluating the detector

  New checks save the model's own counts (`seen`), and older checks are read back from their notes. Labels are kept in `VISION_LABEL_V1::<observationId>` settings and never change farm records. Measuring the licensed datasets and training or adopting the CPU detector remain to do.

**Phase 3: recordings and time-of-day sampling.** Sample archived clips across morning, feeding, midday, evening and
night. Deduplicate, keep short evidence around findings, and disclose missing recordings and camera clock drift.

**Phase 4: layers and eggs.** Nest and floor-egg observations with deduplication, reconciled with `EggCollection`.
Counts are enabled only after validation.

**Phase 5: people and biosecurity.**
- A presence timeline, with first and last time seen and no identity.
- Privacy and retention controls.
- Animals and pests seen.

**Phase 6: the reference library and rules.**
- Stage, thermal and litter guidance with source, version and date.
- Sources: Ross, Cobb, Hy-Line, WOAH, and the owner's Caribbean guides (broiler management, layer daily, weekly and
  monthly tasks, egg handling and shell quality).
- Configurable by type, age, strain and housing.

**Phase 7: Oriya reports.** The daily report and on-request analyses ("Check Pen 1") through Operator Mode. This needs
the agreed message type on Oriya.

## 4. Rules that apply to every phase

- Vision never changes official records: mortality, live count, feed, water, eggs or money.
- Measured facts, visual estimates and suspicions are shown apart. A hidden feeder is "not in view", not "empty".
- No disease diagnosis.
- Every finding has evidence and a time.
- "No alert" is never shown as "healthy" when coverage is missing.
- Confidence shown to farmers is labelled as model confidence until a measured accuracy exists.
- Each farm's pictures stay its own. Nothing is used for shared training without explicit permission.
- No facial recognition and no identity guessing.
- Costs stay within the plan limits and budgets already in place.

## 5. Pen size and layout recommendations

A normal camera cannot measure distance by itself: a small pen seen close up and a large pen seen from far away can
look the same. Flockence will do this in three ways, most reliable first:

1. **Recorded dimensions.** The pen length and width entered in farm setup give the floor area, stocking density
   (kg/m² from the ledger's live birds and the latest weights) and the feeder, drinker and airflow needs
   (`lib/house-advisor.ts`).
2. **A known measurement in view.** The farmer marks the real size of something the camera sees: a feeder pan
   diameter, a door, or two floor marks a known distance apart. Vision then estimates distances along the floor, as
   an estimate with stated accuracy.
3. **Equipment seen against the guidance.** Vision counts the feeders and drinkers it can see, and notes empty corners,
   crowding at stations and wet areas. It compares them with what the recorded size and bird numbers need.

It then recommends a layout: for example add two feeder pans, spread the drinker lines, or move a heater away from a
wall. Each recommendation names the guidance it uses. Vision does not invent a pen size from pictures alone.

## 6. Decisions needed from the owner

1. **Phase 1 first**, as above, before any detector work.
2. **Free plan:** one full daily report by email, per the brief. Do Free farms also get manual inspections?
3. **Detector compute:** CPU on the VPS (cheap, sampled frames), or a later GPU or farm edge box for continuous video.
4. **Oriya:** agree a daily-report and on-request message type with the Oriya side. Alerts already work.
5. **Dataset licences:** PIO (CC BY 4.0) is usable; ChickenVerse needs a commercial licence.
6. **Labelling:** 50–100 of the farm's own pictures labelled by the owner, for Phase 2.
