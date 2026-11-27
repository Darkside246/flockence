# Poultry vision datasets and how Farm Vision gets better (2026-11-27)

The owner is arranging licences. Until a licence is confirmed in writing, a dataset is used only for internal,
non-commercial evaluation, never to train a model that is sold or served to farms.

## What Farm Vision does today

Each inspection sends the farm's pictures to a general vision model (Claude Haiku 5.5 through OpenRouter on
flockence.com), together with:
- a poultry checklist, in order: birds (spread, activity, posture, panting, huddling, lameness), feed, water, the
  house, then heat and cold judged against the flock's age and the recorded temperature
- the farm's own records: flock age, breed, live count, recent deaths, the latest daily check and sensor readings
- for camera inspections, the same camera's previous picture (30 minutes to 12 hours old), so a bird lying in
  exactly the same place and position in both pictures while others moved is flagged as possibly dead or down
  ("stillBirds")

The model also lists what was out of view, gives an approximate count of the birds it can see, and asks the farmer
when it is unsure. This is prompting, not training: it can be improved and measured, but it is not a trained poultry
detector.

## Datasets found

| Dataset | What it has | Licence (to confirm) | Best use for Flockence |
| --- | --- | --- | --- |
| [ChickenVerse](https://github.com/amirivojdan/ChickenVerse) ([Zenodo](https://zenodo.org/records/20672799)) | ChickenDet: 6,539 broiler images, 153,764 boxed birds; segmentation; ChickenAct behaviour clips from five farms | Zenodo record: CC BY-NC-SA 4.0 (non-commercial, share-alike). The SSRN paper page says all rights reserved. Already used for research reports in Farm Vision (docs/POULTRY_INTELLIGENCE.md). | Measuring bird-count accuracy; behaviour (eating, drinking, resting); training a counter only with a commercial licence. |
| [PIO](https://www.nature.com/articles/s41597-026-07114-5) | 1,487 images, more than 327,000 boxed broilers, commercial and prototype houses (Panama) | CC BY 4.0 (commercial use allowed with credit), per its metadata | The best candidate for a bird detector and counter that Flockence may ship. |
| [Dead chicken detector](https://universe.roboflow.com/ameer-ali-chandio-l3df5/dead-chicken-detector) (Roboflow) | 86 images, one class: dead bird | Not shown; check the Roboflow page | Small test set for dead-bird detection. |
| [AIdotyam/ML](https://github.com/AIdotyam/ML) | A dead-chicken detector trained on about 7,000 images built from Roboflow sets | Check the repository and the source sets | Reference for a dead-bird model; data source to trace. |
| [Broiler healthy/sick](https://universe.roboflow.com/technicalresearch/broiler-chicken-healthy-and-sick) (Roboflow) | Healthy and sick broiler boxes | Not shown | A weak proxy for "bird looks unwell"; test only. |
| [Birds' Eye View](https://arxiv.org/pdf/2205.00069) | Per-bird posture and eating/drinking at the feeder and drinkers | Not stated | Feeder and drinker behaviour, if the authors share the data. |
| [Laying-hen feeder and waterer set](https://doi.org/10.3390/agriculture15181963) | 700 images: hen, feeder and waterer boxes | Not stated | Feeder and drinker detection for layers. |

There is no large open dataset of dead broilers; the ones found are small. The farm's own pictures, labelled, will
matter most.

## Plan, in order

1. **Measure first (no training).** Build an evaluation set:
   - 50 to 100 of the farm's own saved pictures (good, problem, dark, crowded), each labelled by the owner:
     roughly how many birds are in view, any dead or down bird and where, feeders empty or not, drinkers working or
     leaking
   - plus PIO and ChickenVerse images for bird counts
   - Run it through the current model and the alternatives (Claude Haiku 5.5, Claude Sonnet 5.5, others on
     OpenRouter), and record count error, dead birds found and missed, false alarms and cost per inspection. Pick
     the cheapest model and prompt that are good enough, with numbers.
2. **Tune the prompt** against that set, keeping what improves the numbers.
3. **Only then, a trained detector**, if counting or dead-bird detection is still not good enough. It would be a small
   bird detector (for example a YOLO-family model) trained on PIO (CC BY 4.0) plus the farm's own labelled pictures,
   running on the VPS or the camera worker. It would count birds and find lying-still birds between pictures cheaply.
   The general model would keep describing the pen. ChickenVerse may be used for this only with a commercial licence.
4. **Keep a record:** each dataset's licence, version and where it is used, in this file.

## Bird-count test on ChickenVerse

`scripts/chickenverse-count-test.mjs` measures how well Farm Vision counts birds. It takes pictures from the
ChickenDet **Test** split (250 pictures, 12,620 boxed birds), sends each through the same model and pen-inspection
prompt the farm uses, and compares Vision's `birdCount.visible` with the number of birds the researchers boxed.

- It reads only what it needs from the official 4 GB `ChickenDet.zip` on Zenodo: the zip's index, the 10 MB Test
  annotations and the sampled pictures, all kept in `~/.cache/flockence-chickenverse` so a second run (for example
  with another model) downloads nothing. It downloads over 6 connections at once, because Zenodo is slow on one.
  Nothing is saved to the farm's history.
- The sample is repeatable (`--seed`) and spread over crowding levels (0, 1-10, 11-30, 31-60, 61-100, over 100 birds).
- Each picture is one paid vision call. It stops at `--max-cost-usd` (default $1.00). With Claude Haiku 5.5 on
  OpenRouter expect very roughly half a cent per picture.
- Results go to a new folder: `report.json` (overall, by crowding level, by the model's own confidence) and
  `pictures.csv` (one row per picture: boxed birds, Vision's count, its note on what limited the count, cost).

On the server, from the live release folder (so it uses the server's vision settings and key, read from the release's `.env`; use
`.env.production` or `.env.local` in the command instead if that is where the key is). The release must
include this script, so deploy first. The dry run lists and fetches the chosen pictures and makes no paid calls:

```sh
cd "$(systemctl show -p WorkingDirectory --value flockence)"
sudo -u flockence -H node --env-file=.env --experimental-strip-types scripts/chickenverse-count-test.mjs --pictures 5 --dry-run
sudo -u flockence -H node --env-file=.env --experimental-strip-types scripts/chickenverse-count-test.mjs --pictures 40 --max-cost-usd 1 --out /tmp/cv-count-1
```

To compare models, run again with `--model` (for example `--model anthropic/claude-sonnet-5.5`) and the same seed.
The figures to read: **median miss** (birds), **mean error %**, the share **within 10% / 20%**, and **bias**
(negative means Vision misses birds, usual in crowded pens). ChickenDet is from US broiler houses; the farm's own
pictures still need their own test.

ChickenVerse is CC BY-NC-SA 4.0. The owner approved this test while the commercial licence is arranged
(2026-11-27). The test only measures; it does not train anything.

## Not done yet

- No dataset has been downloaded into Flockence's production systems, and no model has been trained.
- The licences above are as listed on their pages and are not legal advice.
- The new checklist, earlier-picture comparison and still-bird flag have not yet been measured on real farm pictures.
