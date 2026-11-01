# Chicken Op Poultry Industry Audit - 2026-10-07

## Scope

This audit reviews the current Chicken Op codebase against practical broiler production, harvest, processing, transport, inventory, food-safety and farm-accounting workflows. It is deliberately broader than a UI review.

Industry references used include FAO poultry production and transport guidance, WOAH poultry transport welfare standards, Aviagen broiler performance guidance, extension guidance on brooding and water management, and Barbados Veterinary Services / food-hygiene information.

## Implemented in this branch

### 1. Daily flock lifecycle

- Hatch date is the primary lifecycle anchor.
- Purchase date is retained separately.
- If hatch date is unavailable, purchase date becomes an explicitly labelled estimated lifecycle anchor.
- Age is calculated daily.
- Default harvest planning age is 42 days and is configurable per batch.
- Expected harvest date is generated from the lifecycle date and target age.
- Harvest mode can be AGE TARGET, WEIGHT TARGET, AGE OR WEIGHT, or MANUAL.
- A live-weight target can be stored per batch.
- Two or more live-weight records can produce observed average daily gain and an estimated target-weight date.
- Birds can remain in production beyond six weeks. The system does not automatically mark them ready merely because day 42 has arrived.

### 2. Processing outputs

The previous model could record inventory manually but did not make the slaughter-to-products relationship explicit.

The new processing workflow can record:
- whole carcasses
- giblets
- liver
- gizzard
- heart
- feet
- neck
- wings
- cuts/parts
- other edible or non-edible outputs
- waste/condemned material

Each processing output is linked to the batch and optionally the slaughter event, and an inventory record is created at the same time. This means the output can flow into the existing sales and household-use system instead of becoming a disconnected spreadsheet entry.

### 3. Slaughter yield

Slaughter events now have fields for:
- birds sent
- birds slaughtered
- condemned
- total live weight
- total dressed weight
- chilling completion time
- notes

The reporting layer can calculate dressing percentage when both live and dressed weights exist.

### 4. Transport

Transport is now separated into a physical journey record and the existing financial transportation expense.

A transport event can capture:
- live chick delivery
- live birds to processor
- live birds to market
- processed meat delivery
- departure/arrival
- origin/destination
- carrier, vehicle and driver
- crates
- birds loaded/arrived
- dead on arrival
- distance
- ambient temperature
- feed-withdrawal duration
- water availability
- welfare check
- sanitation check
- notes

This prevents a transport trip from being reduced to a fuel expense while still allowing the financial expense to remain separate.

### 5. Cold-chain monitoring

The inventory workflow now assesses each storage temperature reading against the configured minimum and maximum for that location. It distinguishes readings within range, out-of-range readings, missing limits and invalid limits. Invalid limit order and out-of-range target settings are rejected when a new storage location is configured.

Operators can enter the actual measurement timestamp and the person who measured it. Browser datetime-local values are interpreted in the farm's Barbados timezone, rather than the server or browser timezone. Future readings are rejected. Owners and managers can edit storage-location settings so temperature ranges and capacity can be corrected without creating a duplicate location.

The operator sees an alert for a location's latest out-of-range reading and can review recent temperature history with its range assessment and notes. Temperature log queries are bounded. Storage occupancy shows recorded weighted stock against configured capacity. Utilisation percentages are withheld where one or more assigned inventory records lack usable weight data; over-capacity warnings can still appear when the known weight alone exceeds capacity. These checks use the existing schema; they do not yet create a separate corrective-action or excursion-resolution record.

Product-temperature measurements at packing and dispatch, sanitation verification, HACCP/CCP capture and a formal corrective-action / recall workflow remain on the roadmap.

## Current strengths already present

The repository already has a strong base for a small-farm operations platform:

- batch tracking
- mortality
- bird counts
- feed purchases and feed usage
- bedding
- expenses and recurring expenses
- transportation expenses
- weights
- slaughter
- inventory
- sales and payment status
- household consumption
- customers and suppliers
- health cases
- treatments and withdrawal dates
- diagnostic tests
- biosecurity logs
- equipment
- tasks
- production planning
- reports
- audit logs
- Farm Vision
- PWA foundation

## Important gaps that remain

### A. Production records

High priority:
- breed/strain and hatchery
- sex or mixed-sex flock where relevant
- chick placement quality
- source flock / supplier lot
- daily or scheduled feed consumption
- water consumption
- feed phase/formulation
- feed wastage
- body-weight sampling schedule
- uniformity / coefficient of variation
- average daily gain
- feed conversion ratio with stricter actual-data rules
- livability
- mortality by cause
- culls
- daily house observations
- stocking density by usable floor area
- house/pen assignment history

The current system has many ingredients for these metrics but still needs a dedicated flock-performance data model and a clean daily entry workflow.

### B. Environment

High priority:
- daily temperature
- relative humidity
- ventilation/fan status
- ammonia observations or sensor readings
- lighting schedule
- litter condition
- water pressure/availability
- water quality tests
- power outages
- generator/backup events
- heat-stress events

These are operational variables, not just health notes. Brooding temperature, humidity, ventilation and water availability materially affect growth, feed efficiency and mortality.

### C. Health and biosecurity

The current health system is a good foundation but should eventually add:
- vaccination schedule and administration records
- vaccine product, lot and expiry
- cold-chain record for vaccines
- treatment lot/expiry
- explicit food-animal withdrawal lock on sale/slaughter
- medication withdrawal warnings on the dashboard
- isolation/quarantine movement log
- visitor and vehicle biosecurity
- cleaning/disinfection schedules
- pest-control records
- dead-bird disposal records
- corrective actions
- veterinarian/contact history

A treatment record should be able to block a batch from harvest or sale until the recorded withdrawal period clears.

### D. Harvest and processing

High priority:
- pre-slaughter holding record
- feed withdrawal start/end
- catching crew
- loading start/end
- lairage/holding time
- DOA rate
- bruising/broken wing observations
- condemnation reason and quantity
- evisceration loss
- carcass yield
- giblet yield
- feet yield
- neck/head yield
- waste yield
- chilling temperature/time
- freezing temperature/time
- packaging date
- package size
- product/lot code
- processor or slaughter location
- inspection status

Giblets must not be treated as a single invisible value. They are saleable inventory streams when the farm keeps them.

### E. Cold chain and food safety

High priority if Chicken Op will support commercial sale of processed poultry:
- cold-room/freezer temperature logs
- product temperature at packing
- product temperature at dispatch
- storage location
- lot/pack code
- production date
- use-by/best-before field where legally appropriate
- FEFO/FIFO stock rotation
- sanitation verification
- cleaning chemical records
- HACCP/CCP records
- corrective actions
- recall/traceability workflow

FAO food-hygiene guidance emphasizes lot identification, storage-temperature records, processing records, transport temperature records and corrective-action documentation. The application should eventually make those records first-class rather than free-text notes.

### F. Inventory

Current inventory is useful but should mature into true stock control:
- stock movements ledger rather than only current quantity
- receipt, production, sale, household use, adjustment, damage and disposal movements
- frozen/chilled status
- location
- lot/batch code
- expiry
- reserved stock
- FEFO/FIFO
- partial-package handling
- product variants and pack sizes
- automatic reconciliation between processing outputs and inventory

### G. Sales and distribution

Still needed:
- customer orders
- order status
- delivery routes
- delivery driver
- proof of delivery
- outstanding invoices
- customer credit limits
- delivery charges
- returned product
- rejected/damaged delivery
- product-level profitability
- recurring customers
- wholesale versus retail pricing
- price history

### H. Waste and manure

This is a major opportunity for a small farm and should not be left as an expense-only concept.

Add:
- manure/litter produced
- estimated or measured quantity
- storage location
- age/composting status
- disposal method
- sale price
- free transfer
- field application
- transport cost
- value recovered

Poultry manure/litter is an economically useful by-product when managed correctly, so Chicken Op should eventually treat it as a potential resource rather than simply waste.

### I. Financial model

The current costing foundation is good but needs:
- cost per live kg
- cost per dressed kg
- cost per carcass
- cost per sellable kg
- processing cost by product
- transport cost per bird/kg/order
- feed cost per kg gain
- contribution margin by product
- break-even flock size
- break-even live weight
- break-even dressed price
- sensitivity to feed price
- sensitivity to mortality
- sensitivity to market price
- cash versus economic profit
- owner labour as optional economic cost
- depreciation
- equipment maintenance
- cold storage cost

### J. Planning

Production planning should eventually understand:
- house capacity
- pen capacity
- stocking density
- staggered placements
- slaughter capacity
- processing capacity
- freezer/cold-room capacity
- expected sales demand
- feed purchasing lead time
- chick ordering lead time
- slaughter booking
- transport availability
- cash required before harvest

The planner should warn when a proposed batch would exceed any of these constraints.

## Cohesion rule

Chicken Op should follow one data flow:

CHICK SOURCE
-> BATCH
-> DAILY AGE
-> HOUSE/PEN
-> FEED + WATER + ENVIRONMENT
-> HEALTH/BIOSECURITY
-> WEIGHTS
-> HARVEST DECISION
-> CATCH/TRANSPORT
-> SLAUGHTER
-> CARCASS + GIBLETS + FEET + PARTS + WASTE
-> INVENTORY LOTS
-> ORDERS
-> SALES/DELIVERY
-> CASH + ECONOMIC PROFIT
-> REPORTING

No screen should ask the farmer to re-enter information that already exists.

Examples:
- The operations screen should load batches from the batch table.
- The lifecycle screen should calculate age from the batch record.
- Slaughter should load the batch's current live count and latest weight.
- Processing should default to the slaughter event just created.
- Inventory should inherit batch and processing provenance.
- Sales should consume existing inventory.
- Reports should aggregate the same records instead of maintaining separate totals.
- Transport should attach to the batch or slaughter event.
- Withdrawal warnings should flow into harvest and sales decisions.

## Industry basis

- FAO identifies feed, water, health, environment and waste management as central poultry-management concerns.
- UGA extension guidance emphasizes temperature, humidity, ventilation and water as important production variables.
- Aviagen identifies livability, live weight, age and FCR as key broiler performance parameters and provides EPEF as a composite performance measure.
- WOAH transport guidance emphasizes planning, handling, stocking density, thermal comfort, container condition, injury and mortality outcomes.
- FAO food-hygiene guidance emphasizes lot identification, temperature monitoring, processing records, transport records and corrective actions.
- Barbados Veterinary Services is responsible for animal health and the safety of foods of animal origin, while Barbados food-hygiene requirements apply to food handling, transportation and service.

## Priority roadmap

### P0 - Core flock truth
1. Lifecycle fields and daily age
2. Weight-based harvest decision
3. Partial/multi-day slaughter
4. Processing outputs and inventory linkage
5. Transport journey records
6. Withdrawal lock
7. Daily flock dashboard

### P1 - Production intelligence
1. Feed/water daily usage
2. environment records
3. ADG/FCR/livability/uniformity
4. stocking density
5. vaccination and health schedules
6. cold-chain logs
7. manure/litter accounting

### P2 - Commercial operations
1. orders and deliveries
2. lot/traceability
3. FEFO/FIFO
4. customer credit
5. product-level margins
6. demand-driven production planning

### P3 - Advanced farm automation
1. sensor ingestion
2. automated anomaly alerts
3. camera-based flock counts
4. predictive harvest windows
5. feed procurement forecasting
6. cold-storage capacity forecasting
7. integrated manure/by-product marketplace

## Bottom line

Chicken Op already has a surprisingly broad operational foundation. The biggest structural improvement is to stop treating the flock as ending at "slaughter". A real poultry operation produces several economic streams from the same bird. Chicken Op should preserve that lineage all the way from hatch date to carcass, giblets, feet, parts, waste, inventory, sale and final margin.

The lifecycle and processing work in this branch establishes that direction without making the farmer enter the same facts repeatedly.
