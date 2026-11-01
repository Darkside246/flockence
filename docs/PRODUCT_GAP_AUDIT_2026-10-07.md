# Chicken Op product gap audit - 2026-10-07

## What the current build covers

- Batch lifecycle with hatch date as the primary age anchor and purchase date fallback.
- Age-based, weight-based and mixed harvest decisions.
- Partial slaughter and condemnation accounting.
- Carcass, giblet, feet, parts, by-products and waste outputs.
- Processing outputs automatically create inventory records.
- Live-bird and processed-product transport records.
- Health cases, treatments, withdrawal dates, diagnostics and biosecurity records.
- Feed, bedding, expenses, sales, household consumption and profitability.
- Live weather endpoint with cached current conditions and a 3-day hourly forecast.
- Weather heat-watch advisory on the farm dashboard.
- AURA server integration for live farm catalogue, quoting, confirmation and order status.

## Benchmark findings

PoultryPlan emphasizes flock setup, production records, weight/feed/mortality, self and group benchmarking, vaccination/actions/tasks, calamity warnings, relocation, financial stock/prices, transport and processor workflows.

Poultrix emphasizes real-time feed, water, weight, mortality and climate, predictive mortality/FCR/harvest, feed optimization and integrations with controllers, processing plants, feed mills and ERP systems.

Farmbrite is a useful cross-species benchmark for mobile/offline field work, inventory, orders, scheduling, weather and an external API.

Chicken Op should not copy these products screen-for-screen. The better opportunity is to make the common farmer workflow require fewer taps and automatically carry information forward.

## Highest-priority gaps

### P0 - farmer daily command center

One screen should answer:

1. Which flocks need attention today?
2. How many birds are alive?
3. What is today's expected weight?
4. How much feed and water were used?
5. What is today's mortality and change from normal?
6. What is the house temperature/humidity?
7. What does outside weather predict for the next 12 hours?
8. Which birds are approaching the harvest window?
9. Is any health treatment still under withdrawal?
10. What orders need to be prepared or delivered?
11. What feed, bedding or packaging needs to be purchased?

The user should be able to complete the normal daily round from this screen without navigating through unrelated accounting screens.

### P0 - climate and heat intelligence

Weather should be advisory, not the farm's environmental truth.

Next stage:
- compare outside weather to each house's actual temperature and RH;
- flag hot houses rather than only hot days;
- consider age, live weight and stocking density;
- monitor panting/wing spreading, water intake, feed intake and mortality as outcome signals;
- flag ventilation or backup-power failures;
- support sensors later through a normalized environment API.

### P0 - feed and water workflow

Add one fast daily entry that records feed used and water used together, optionally by house/pen and feed phase.

Automatically calculate:
- kg feed per bird;
- water-to-feed ratio;
- feed variance;
- projected feed required to harvest;
- reorder date;
- feed cost per live kg.

### P0 - harvest/processing pack

After slaughter is recorded, present a single processing checklist with common products:
- whole carcass;
- liver;
- gizzard;
- heart;
- feet;
- neck/head;
- wings/legs/breast;
- saleable cuts;
- condemned;
- waste/manure.

The farmer should tick what is kept and enter quantities once. Inventory should inherit batch, slaughter event, date and lot provenance automatically.

### P0 - withdrawal lock

Before harvest or sale, show a hard warning when any active treatment has a future withdrawal clearance date.

The system should never decide that a product is safe because a generic number of days has passed. It should use the recorded product, treatment and applicable withdrawal record.

### P1 - production intelligence

- breed/strain, sex and hatchery/source lot;
- house/pen assignment and stocking density;
- weight sampling schedule and flock uniformity/CV;
- ADG and interval-specific FCR;
- mortality causes and culls;
- daily house observations;
- ammonia and air-quality logging;
- water quality and pressure;
- power outage/generator events;
- litter scoring;
- vaccination lot/expiry and treatment lot/expiry;
- catching crew, feed withdrawal, lairage and processor records;
- bruising, broken wings/legs, condemnations and DOA rates;
- chilling/freezing temperature and cold-room capacity;
- lot codes and FEFO/FIFO;
- stock movement ledger;
- delivery routes, proof of delivery and returns;
- manure/litter storage, sale, field use and disposal;
- contribution margin and sensitivity analysis;
- demand versus slaughter/processing/freezer capacity.

### P1 - field reliability

Build true offline-first capture for the normal farm round. A field worker should be able to record mortality, weights, feed, water, health observations and tasks with no signal, then sync later.

### P1 - AURA integration

Current bridge is deliberately narrow.

Next:
- make Chicken Op connections per AURA business rather than environment-wide;
- allow AURA to answer live flock questions;
- allow AURA to tell a farmer which batch is ready;
- allow AURA to prepare procurement suggestions;
- allow AURA to send proactive farmer alerts;
- add order cancellation and delivery changes through guarded workflows;
- add lot-aware inventory answers.

## Product principle

The strongest differentiator should be:

ENTER ONCE -> CALCULATE AUTOMATICALLY -> REUSE EVERYWHERE -> ASK AURA WHEN HANDS ARE BUSY.

No screen should ask the farmer to re-enter data the system already knows.
