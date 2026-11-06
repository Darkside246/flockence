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

## Not built yet (honest list)

1. **Feed leftovers, spillage and returns**: the engine can tell feed issued from feed eaten (scenario E passes as maths), but the app has no form or table for leftover or spilt feed yet.
2. **Water tank and meter readings**: the engine handles meters (including resets); the app still only has litres on the daily check.
3. **Egg breakdown**: the existing collection form has dirty, cracked, floor and rejected eggs. Broken, kept-for-house and set-for-hatching are in the engine but not the form.
4. **Slaughter straight into stock**: meat still enters inventory when the processing pack is recorded, not at slaughter, so the storage check cannot count meat from a slaughter whose pack is not recorded.
5. **Waste and by-product accounting** beyond the existing manure records.
6. **House allocation at placement**: flocks are not linked to a house when they are placed, so the house split is only as good as the transfers recorded.
7. **Age-specific heat thresholds**: heat exposure uses a single threshold (32 °C by default), not a temperature curve by age.
8. **Forecasting models beyond medians**: there is no regression of weight on age yet; it needs more weighed history.
