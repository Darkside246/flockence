# Record once, calculate everywhere: data-flow audit and what changed

## What the audit found

| Area | Before | Problem |
| --- | --- | --- |
| Live birds | Worked out separately in 12 places (mortality, daily check, slaughter, weights, batches, dashboard, operator round, performance, Oriya link, and more) from "latest BirdCount row + losses after it". | The "Calculated after…" BirdCount rows were stored results treated as facts. A corrected loss left them wrong; the flock edit had to shift them by hand. |
| Birds added later | No record type at all. | Impossible to add birds to a flock without corrupting its counts. |
| Transfers between houses | No record type; flocks are not linked to houses. | Moves could only be written as notes. |
| Culled and missing birds | Only "mortality" with a free-text reason. | Culls and unexplained losses were mixed in with birds found dead. |
| Corrections | None. A wrong loss could only be left or the whole flock deleted. | No audit trail of changes to counts. |
| Duplicate submissions | Daily check deaths were protected; mortality, slaughter and others were not. | A retry on a weak connection could record the same deaths or slaughter twice. |
| Slaughter | Checked birds available and withdrawal; no estimate of meat, no storage check, no way to learn the farm's yield. | Dressed weight did not say whether giblets were included, so a yield could not be trusted. |
| Egg collection | Laying hens prefilled for today only, from a client-side count that ignored slaughter and additions. | Earlier dates started blank; the farmer had to enter hens again. |
| Feed | Purchases and usage (kg) exist; usage is also written from the daily check (no double entry). | No record of leftovers, spillage or returns, so "eaten" cannot be told from "issued". |
| Water | One litres figure on the daily check. | No tank or meter readings, so usage cannot be measured independently. |
| Heat | Thermometer readings stored per sensor. | Not linked to flocks or compared with feed, water and losses. |

## Single source of truth for birds

`lib/flock-ledger.ts` is now the one place that works out a flock's birds:

birds placed + **BirdMovement** additions − **MortalityEvent** (died, culled, missing) − **SlaughterEvent** birds sent,
with real head counts treated as observations. A head count that differs from the records is shown as
"unaccounted", never booked as deaths.

- `BirdCount` rows whose note starts "Calculated after" are now **projections**: shortcuts that older pages read. They are
  never trusted by the ledger and are rebuilt from the events after any correction (`rebuildBirdProjections`). Head counts
  and the initial count are never touched.
- Every write path (mortality, daily check, slaughter, bird movements, flock edit) checks against the ledger, and refuses
  any change that would leave a later day with fewer than zero birds.
- Flocks that reach zero live birds close themselves; an addition reopens a closed flock.

The arithmetic lives in `lib/farm-engine.mjs`: pure functions with no database or clock, unit-tested in
`tests/farm-engine.test.mjs`. Counts are integers; kilograms and litres are summed as whole grams and millilitres.

## New and changed records (additive schema change, needs `npx prisma db push`)

- `MortalityEvent.kind`: `DIED` (default, so all existing rows keep their meaning), `CULLED` or `MISSING`.
- `MortalityEvent.correctedAt`: set when a loss is corrected; the before and after are in `AuditLog`.
- `BirdMovement`: `ADDITION` (birds join the flock, with source, house and cost) or `TRANSFER` (house to house, the flock
  total is unchanged). Mistakes are voided, never deleted.
- `SlaughterEvent.dressedDefinition`: `CARCASS` or `CARCASS_WITH_GIBLETS`. Only slaughters that say which are used to learn
  the farm's yield.

## Routes

| Route | What it does |
| --- | --- |
| `GET /api/flock-ledger?batchId&date` | Live birds on a date and every step of how the number was reached. |
| `POST /api/bird-movements` | Birds added or moved between houses. `PATCH ?id=` voids a mistake (owner or manager). |
| `POST /api/mortality` | Now takes `kind` and `submissionId` and returns `liveBirdsNow`. |
| `PATCH /api/mortality?id=` | Corrects a loss in place (owner or manager), with a required reason; audit logged; projections rebuilt. |
| `POST /api/daily-flock-check` | Birds died and birds culled are separate records; returns `liveBirdsNow`. |
| `POST /api/slaughter` | Retry-safe (`submissionId`), records `dressedDefinition`, logs a storage override, returns `liveBirdsNow`. |
| `GET /api/slaughter/intelligence` | Before slaughter: birds, age, expected meat and whether it fits the store. After slaughter (`?slaughterEventId`): average live weight, measured or worked back. |
| `GET /api/flock-insights?batchId` | The last 14 days per bird (feed, water, water-to-feed, losses), unusual changes against the flock's own history, and heat exposure from the house sensors. |

Every POST that changes birds accepts a `submissionId`; sending it twice returns the first record.

## How estimates are labelled

- **Measured**: birds weighed, sensor readings.
- **Calculated**: live birds, hen-day %, feed per bird-day: exact from the records.
- **Estimated**: live weight worked back from dressed weight, expected meat before slaughter. Each estimate gives its basis and a range.
  - With 3 or more past slaughters where live and dressed weight were both weighed and the carcass definition recorded, the farm's own ratio is used. The range is a 95% prediction range from how much that ratio has varied.
  - Without them, a published reference ratio (72–75%, broiler carcass without giblets) is used, labelled "Reference estimate: not yet calibrated to your farm".
  - A ratio measured with giblets is never applied to a carcass weighed without them.
- **Forecast**: feed coverage. Labelled as a forecast.
- **Missing**: shown as missing with what to record, never filled in.

## Scenario results

Engine (unit tests): A, B, C, D, E, F, G, H math, plus transfers, culls, head-count gaps, bird-days, kilograms to the gram, water, heat (gaps not filled), yield and unusual changes. 27 tests.

API, on a throwaway Postgres container with a fresh schema, through the real routes (37 checks, all passing):

- A: 20 placed, 2 died → 18, then 1 more at the daily check → 17. The flock list agrees.
- B: 5 added → 22, with its own dated line. The flock list agrees.
- F: 120 placed, 5 died, 100 slaughtered → 15. Slaughter is not counted as mortality, and sending more than 15 is refused.
- G: the live weight is worked back from 175.2 kg dressed (2.417 kg, reference estimate). After 3 weighed slaughters it uses the farm's own ratio (72%). Weighed birds use the measured weight.
- H: a 50 kg freezer is too small for 100 birds, and the shortfall is shown. The slaughter can still be recorded, with an override reason in the audit log.
- I: a death corrected from 2 to 1 gives one bird back. The record is changed in place, not duplicated. The as-of-date counts and the flock list agree, a reason is required, and a worker cannot correct.
- J: a repeated addition, death, daily check and slaughter are each counted once.
- K: the dashboard, flock list, ledger and insights agree. Voiding an addition takes the birds back off everywhere.

## Second round (2026-11-06): the eight items that were not built

| Item | How it works now |
| --- | --- |
| Feed leftovers, spillage and returns | `FeedUsage` gains `leftoverKg`, `spillageKg`, `returnedKg`; the daily check asks for them after "feed put in the feeders". Eaten = put out + yesterday's leftover − today's leftover − spilt − returned, only on days the leftover was weighed (otherwise shown as "put out", not "eaten"). Store = bought − put out + taken back; procurement uses the same figure. `GET /api/feed-ledger`. |
| Water meters and tanks | New `WaterReading` (meter dial or tank level, refills and other use). A reading on the daily check fills in the litres used itself; a separate "Feed and water" form takes readings at any time. A meter that goes backwards or a tank that rises without a refill is flagged, not turned into a number. `GET/POST /api/water-readings`. |
| Eggs | `brokenEggs`, `householdEggs`, `hatchingEggs` on the collection; the categories must add up to the total; older forms that do not send them still save. |
| Slaughter straight into stock | With a dressed weight, what it includes, and a store chosen, the slaughter save creates the whole-bird stock lot, its processing output and its stock movement in the same transaction, once. The processing pack then only needs giblets, feet, cuts and waste; entering the same whole birds again is refused. |
| Waste and by-products | Dead birds by kind and how they were disposed of (new `MortalityEvent.disposal`), processing outputs split into food, by-products and waste with what was done with them, the unaccounted part of the live weight when it was weighed, damaged eggs, spilt feed, manure and stock written off. `GET /api/waste-summary`. |
| House at placement | `Batch.placementHouse`, chosen from the pens when the flock is made or edited; transfers move birds from it. |
| Heat by age | Broiler whole-house targets from the Ross handbook table by age (30 °C at day 0 down to 20 °C from day 27), with ±3 °C counted as on target, alongside the fixed 32 °C heat-stress line. |
| Weight forecast | Least-squares fit of this flock's live weighings against age: a straight line with 3–4 weighing days, a curve with 5 or more; a 95% prediction range from the fit; never more than 21 days past the last weighing. The pre-slaughter check uses it when the last weighing is more than 3 days old. |

### A bug found on the way (existed before this work)

The farm-isolation layer checked every linked id outside the current transaction, so a save that created a row and then
pointed at it in the same transaction (an egg collection's stock item, a new product in the processing pack) was refused
with `LINK_OUTSIDE_FARM`. Rows created by the same request through the scoped client are now remembered and accepted;
the farm-isolation tests (8) still pass.

### Second-round tests

31 API checks on a throwaway database (feed 300 + 150 − 100 → 350 kg and 93 kg eaten; carry-over; refused over-spill; meter
1000 → 1250 = 250 L; tank with refill and other use = 450 L; rising tank flagged; eggs 90/3/2/3/2 saved and a mismatch
refused; 40 birds stocked once on a retry; freezer space counts them; processing pack refuses the duplicate; waste
summary by kind, disposal and output; house split 70/30; 40-day target 20 °C; growth curve from 5 weighings and the
forecast used for slaughter planning), plus the first 37 checks again, 114 unit tests and the 11 existing database tests.

## Still not built

1. Statistical models beyond medians and least squares (no seasonal or cross-flock models).
2. Heat targets for layers and other species: only broilers have an age table.
3. A counted opening stock for feed: the store figure is feed bought through Flockence.
