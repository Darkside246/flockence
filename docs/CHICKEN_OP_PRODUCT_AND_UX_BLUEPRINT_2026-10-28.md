# Chicken Op product, broiler/layer and UX blueprint

**Date:** 2026-10-28  
**Status:** Product direction and release acceptance specification  
**Audience:** Product, engineering, farm operators and QA

## Product goal

Chicken Op should feel like a calm, modern farm workspace rather than a collection of forms. It must help an operator complete the normal farm round quickly, understand what needs attention, and trust that every number came from a recorded event.

The product supports two distinct chicken production systems:

- **Broiler production:** meat birds, measured from placement through growth, harvest, slaughter, processing, inventory and sale.
- **Layer production:** pullets and laying hens, measured through rearing, point of lay, daily egg collection, grading, packing, egg inventory, sales, flock replacement and end-of-lay decisions.

Both use common flock identity, mortality, feed, water, health, biosecurity, housing, staff tasks, expenses, inventory, traceability and reporting services. Their production decisions and dashboards must remain distinct.

## Experience principles

1. **Show the next useful action.** The first screen should answer what needs attention today, why it matters, and how to record or resolve it.
2. **Enter once, reuse everywhere.** A daily flock check updates the canonical count, weight and feed-use records. Slaughter creates processing provenance. Egg grading creates traceable egg stock. Sales consume stock once.
3. **Progressive disclosure.** Show the common fields first. Reveal advanced fields only when the selected species, production type, event or role requires them.
4. **One task per focused flow.** Avoid one enormous form containing every farm capability.
5. **Mobile-first field work.** Comfortable touch targets, camera access, readable labels, drafts and explicit sync status. Desktop and tablet should use the extra space for overview and comparison, not simply stretch phone forms.
6. **Honest numbers.** Distinguish actual, estimated and forecast values. Show “not recorded” instead of substituting zero. Never infer weights, feed use, egg counts, prices or animal-health diagnoses.
7. **Safe by default.** Treatment withdrawal, stock availability, role permissions, duplicate submissions and inventory corrections must be enforced server-side.
8. **Quiet visual hierarchy.** Use consistent type scale, spacing, restrained color, clear status labels and predictable controls. Reserve strong color for urgent exceptions. Avoid decorative cards that compete with the work.
9. **Accessible by design.** Keyboard access, visible focus, semantic labels, non-color status cues, sufficient contrast, reduced-motion support and at least 44-48px interactive targets.
10. **Fast recovery.** Preserve form values after validation/network errors. Explain what failed and how to fix it. Never show a success state before the server confirms a write.

## Recommended information architecture

### Primary navigation

- **Today:** prioritized work queue, alerts, quick capture and farm summary.
- **Flocks:** broiler flocks, layer flocks, pullets, housing/pen assignment and flock history.
- **Daily round:** daily flock checks, mortality, weights, feed, water, climate and observations.
- **Broilers:** growth, harvest readiness, transport, slaughter and processing.
- **Eggs:** collection, grading, packing, cold/storage checks, egg stock and dispatch.
- **Health & biosecurity:** cases, treatments, withdrawal locks, vaccination, diagnostics, cleaning and visitor records.
- **Inventory:** feed, bedding, packaging, medicines, processed poultry, eggs, by-products, lots and stock movements.
- **Orders & customers:** quotes, orders, payments, delivery and proof of delivery.
- **Costs & finance:** purchases, overhead, labour, cash, receivables, batch/flock costs and product margin.
- **Insights:** broiler performance, layer performance, feed, mortality, egg production, profitability and compliance reports.
- **Settings:** farm profile, houses, pens, units, prices, production targets, user roles and integrations.

Navigation must be permission-aware and context-aware. A layer-only farm should not be presented with slaughter as its primary action. A broiler-only farm should not be presented with egg collection as its primary action. Mixed farms need both workspaces.

## Broiler operating workflow

### Setup and placement
Capture flock name, production type, species, breed/strain, hatchery, source/supplier lot, hatch date, placement date, chick quantity, sex, placement quality, house/pen, usable floor area, stocking density and chick cost.

### Daily round
One fast entry per flock/date should capture live count, mortality/culls, feed by phase and quantity, water, sampled average weight and sample size, temperature, humidity, ventilation, litter condition, ammonia where measured, behaviour/welfare observations and notes.

### Performance and harvest
Calculate only from actual records: livability, mortality, average daily gain, interval and cumulative FCR, flock uniformity/CV, live weight, weight distribution and cost per live kg. Harvest decisions may use age, weight or manual review. Day 42 is a configurable planning default, not an automatic harvest command.

### Harvest to revenue
Transport and welfare record -> slaughter event -> condemnations and weights -> processing outputs -> chilled/frozen lots -> inventory movements -> order/sale/household use -> reconciliation and contribution margin.

A batch with an uncleared medication withdrawal must be blocked from harvest, processing, reservation, sale and dispatch as appropriate. The server, not merely the UI, enforces this.

## Layer operating workflow

### Rearing and flock stages
Support chick, grower, pullet, pre-lay, active lay, molt/rest, spent and closed stages. Layer flocks are not assigned a broiler harvest date. Point-of-lay and production targets are configurable reference points, not automatic biological claims.

Capture pullet source, hatch/placement date, breed/strain, sex, house/pen, beak/management notes where applicable, vaccinations, mortality, feed phase, body weights, uniformity and transfer to the laying house.

### Daily egg round
Capture live hens, total eggs collected, saleable eggs, dirty eggs, cracked/broken eggs, floor eggs, rejected eggs, graded quantities (small, medium, large, extra-large, jumbo and ungraded), optional sample egg weight, collection rounds/time, notes and operator.

Validate the daily reconciliation so the exclusive egg outcome counts equal total eggs. Graded quantities must reconcile to saleable eggs. Re-entry for the same flock/date updates the same collection and adjusts generated stock through an auditable inventory correction rather than duplicating it.

### Layer performance
Calculate:
- Hen-day production = eggs collected / live hens x 100.
- Hen-housed production using the original hens placed as the denominator, with deaths and transfers retained in the flock history.
- Saleable percentage = saleable eggs / total eggs x 100.
- Dirty, cracked, floor and reject rates.
- Egg mass per hen per day when representative egg-weight records exist.
- Feed per hen per day and feed cost per dozen when feed usage and live-hen records exist.
- Graded inventory, pack-out, sales, returns, breakage and remaining stock.

Show the denominator and date window beside every rate. Missing denominators must produce “not available”, not zero.

### Egg stock and sales
Each grade/collection produces a traceable lot with flock, collection date, grade, quantity, packaging/pack size, pack date, storage location, storage condition, date code/use-by policy and stock movements. Packaged products must be saleable through the same order, payment and customer workflows without bypassing the inventory ledger.

Use a configurable local shelf-life and storage policy reviewed for the operating jurisdiction. Do not invent a universal expiry date or storage temperature.

### Layer replacement and end of lay
Track pullet pipeline, transfer schedule, target flock size, expected production curve, molt decisions, culls, spent-hen disposition and replacement cost. Keep broiler harvest logic out of layer lifecycle decisions.

## Shared data and operating rules

- Production type is explicit: BROILER or LAYER. Species is a separate field. Legacy records must remain readable during transition.
- All events are farm-scoped and batch/flock-scoped.
- Store currency in integer minor units and weights/quantities in explicit units.
- Record event time separately from entry time when the distinction matters.
- All stock changes produce an immutable movement record.
- Corrections are compensating movements with actor, reason and reference, not silent overwrites.
- Prevent duplicate submits with idempotency keys for network retries and integrations.
- Preserve source provenance from supplier lot through flock, processing/egg collection lot, inventory and customer sale.
- Use tenant-safe authorization on every read and write.
- Offline captures must show queued, synced, failed or conflict status. A queued action is never presented as committed.

## UI and interaction standards

- Dashboard cards must be actionable and link to the relevant flock or task.
- Use a consistent page heading: title, one-line purpose, contextual primary action.
- Use tables for comparison and history; switch to compact record cards on narrow screens.
- Default filters to active flocks and current date; make historical data one clear action away.
- Search by flock, batch, lot, customer and product. Global command search should navigate and launch common actions.
- Forms should be grouped into short sections with inline validation, helpful examples, sensible defaults and explicit units.
- Use confirmations for destructive or stock-affecting corrections. Explain the impact before submission.
- Provide empty states that explain the first useful action.
- Provide loading skeletons and specific error/retry states.
- Do not hide important information behind hover-only interactions.
- Respect saved appearance preferences while keeping every theme readable and tested.

## Release sequence

### Release 1: Safe consolidated foundation
- Rebase development on the farmer command-centre branch.
- Retain lifecycle/processing work already incorporated there.
- Integrate selected security, backup, private-media and CI improvements from the foundation branch only after dependency review.
- Resolve current CI failures and pin a reproducible runtime/dependency set.
- Complete migration strategy, role checks, auditability and inventory consistency.

### Release 2: Broiler and layer daily operations
- Explicit production type and species separation.
- Broiler-specific harvest/processing controls.
- Layer collection, grade reconciliation and generated egg stock.
- Production-type-aware navigation and operational summaries.
- Broiler and layer daily round acceptance tests.

### Release 3: Quality, distribution and financial truth
- Vaccination/cold-chain/HACCP records, traceability and recall.
- Pack sizes, lot rotation, returns, dispatch and proof of delivery.
- Feed/egg/meat costing, labour, overhead and product contribution margin.
- Supplier purchasing and demand/capacity planning.

### Release 4: Field reliability and intelligent automation
- Offline-first capture and conflict resolution.
- Sensor ingestion and alert rules.
- Vision-assisted observations with human review.
- Predictive models only after sufficient clean historical data exists.

## Definition of done

A release is not complete because a screen exists. It is complete when:

1. A new operator can create a flock and finish the daily round without training or duplicate entry.
2. Broiler and layer users see only relevant production actions and metrics.
3. Every number is traceable to its source records and date window.
4. A correction cannot silently corrupt stock or financial history.
5. The same workflow works at phone, tablet and desktop sizes.
6. Keyboard, contrast, focus and reduced-motion checks pass.
7. Schema validation, database integration checks, typecheck, production build and workflow tests pass.
8. Backup and restore are demonstrated before production data is entrusted to the system.
