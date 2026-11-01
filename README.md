# Flockence

**Intelligent Poultry Management**

*Every flock. Every decision. Connected.*

**Powered by Oriya.**

Flockence is a complete poultry operations platform for broiler and layer production, designed for independent farmers through commercial enterprises. Flockence manages poultry operations and remains the operational system of record; Oriya provides shared intelligence and connected business capabilities.

## Current build

The application includes flock and batch tracking, mortality, feed, daily flock checks, inventory movements, sales, slaughter, processing, transport, health records, biosecurity, tasks, planning, profitability, reports, PWA support, and Farm Vision. The active development line now distinguishes broiler meat production from layer egg production instead of forcing both through one lifecycle.


## Development handoff

See [Flockence rebrand and Oriya integration handoff](docs/FLOCKENCE_REBRAND_HANDOFF_2026-10-31.md) for the product identity, architecture, existing Oriya API contract, compatibility decisions, security/release gates, and instructions for continuing development.

## Farm Vision

Farm Vision accepts mobile camera uploads and image files for visual farm inspections. Categories include Pen, Bird, Flock, Droppings, Feed, Water, Equipment, Dead Bird, and Other.

Vision results are intentionally framed as visible observations and investigation prompts. They do not confirm disease or cause of death. Serious findings can be flagged for appropriate animal-health follow-up.

Inspection images are stored outside the public web root in the private `VISION_STORAGE_DIR` directory. The default is `storage/vision`. The API returns evidence only through `/api/vision/media/:id`, which requires a valid farm session and checks the media record against the signed-in farm. The storage directory must be on a persistent, backed-up volume and must never be exposed by the web server as static content.

Legacy images previously stored under `public/uploads/vision` must be migrated during a controlled deployment. Back up the database and both the public and private image directories, block direct web access to `/uploads/vision/`, deploy the schema change, run a dry-run, then run the migration with the explicit backup confirmation flag. See the operations guide below.

The vision integration uses the OpenAI Responses API. The application reads `OPENAI_API_KEY` from the server environment and uses the configured `VISION_MODEL`.

## Optional Blink camera connector

The local FastAPI camera sidecar under [services/blink](services/blink/README.md) provides the camera service used by Flockence. BlinkPy 0.25.9 uses a shared curl_cffi 0.17.0 transport adapter with a configurable Safari/iOS profile and the normal multi-factor verification flow. Local RTSP/ONVIF cameras are also supported. The sidecar binds to loopback and is proxied through authenticated Flockence routes. A real Blink account sign-in and camera image check are still required before relying on Blink cameras for home security.

## Accounting rules

1. Money is stored as integer minor units to avoid floating-point currency errors.
2. Farm-wide utilities and transportation are recorded once.
3. Batch allocations are analytical and do not create duplicate expenses.
4. Actual data is kept separate from estimates and projections.
5. Household consumption has zero cash revenue but can carry an economic value.
6. Remaining inventory is valued using configured selling price where available, otherwise cost basis.
7. FCR and yield metrics should only be calculated when required actual feed and weight records exist.

## Production workflows

**Broilers:** CHICKS → PLACEMENT → DAILY CHECKS → FEED AND GROWTH → HARVEST DECISION → TRANSPORT → SLAUGHTER AND PROCESSING → MEAT LOTS → SALES

**Layers:** CHICKS → GROWER → PULLET → PRE-LAY → LAYING → EGG COLLECTION → GRADING AND PACKING → EGG LOTS → SALES

Both workflows share farm setup, houses and pens, bird counts, mortality, health, biosecurity, feed, inventory, customers, orders, payments and financial reporting. Layer flocks are not assigned broiler harvest dates.

## Technology

- Next.js + TypeScript
- React
- PostgreSQL + Prisma
- PWA/service worker foundation
- OpenAI Responses API for Farm Vision
- Android packaging can be added after the web application is deployed and validated

## Environment

Copy `.env.example` to `.env` and provide a PostgreSQL `DATABASE_URL`. For Farm Vision, add `OPENAI_API_KEY` and set `VISION_STORAGE_DIR` to a persistent private directory. `FARM_ID` selects the farm record set for this deployment. The current access model is one configured farm per deployment. Running multiple customer farms in one shared application deployment requires a further tenant-context and data-access migration.

Production account setup requires `AUTH_SECRET` and an initial `FARM_OWNER_SETUP_CODE`. The first farm owner redeems that code once to establish the owner account. All subsequent staff accounts must use a single-use invitation generated by an owner or manager in Team management.

## Private Farm Vision deployment and legacy migration

1. Take and verify a PostgreSQL backup and a file backup of `public/uploads/vision` before changing the deployment.
2. Configure the web server or reverse proxy to deny direct requests to `/uploads/vision/` during the migration window. Do not expose the old public directory while records are being migrated.
3. Apply a reviewed database migration that adds `VisionMedia` and `HealthObservation.visionMediaId`. The production migration must be generated and tested against a copy of the current production database; do not substitute `prisma db push` for a production migration. Follow [docs/PRODUCTION_DATABASE_MIGRATION_BASELINE.md](docs/PRODUCTION_DATABASE_MIGRATION_BASELINE.md) to establish and validate the migration baseline before production rollout.
4. Configure `VISION_STORAGE_DIR` as an absolute path outside the public web root, mount a durable volume there, and ensure the application process can create and read files. Back up this volume as part of farm recovery.
5. Run a dry-run: `npm run migrate:vision-media`. Review every source and skipped file.
6. After verifying the backup, run: `npm run migrate:vision-media -- --apply --confirm-backup`. The script creates private media records, updates related observations, and removes each public source only after the database transaction succeeds.
7. Confirm that new and migrated image links require a signed-in farm session. Confirm that direct requests to the former `/uploads/vision/` path are denied.
8. Keep the legacy backup offline until the migrated inspection history has been checked.

The migration script defaults to dry-run. `--apply` without `--confirm-backup` is refused. Re-run a dry-run after any interrupted migration to identify remaining legacy records.

## Broiler and layer operating rules

- A flock has an explicit production type: `BROILER` or `LAYER`. Species is stored separately.
- Layer stages are recorded over time so historical production is evaluated using the stage that applied on the selected date.
- Daily egg outcomes must reconcile to total eggs, and graded quantities must reconcile to saleable eggs.
- Each egg collection stores the live-hen count for that date. Historical hen-day production does not use today's count.
- Graded egg output creates inventory lots and stock-ledger movements. Corrections use adjustment movements and cannot reduce a lot below stock already sold or used.
- Layer egg collection is blocked outside the laying stage. Broiler slaughter and carcass-processing endpoints reject layer flocks.
- Layer feed forecasts use a supplier lead-time window, not a broiler slaughter date.

## Backup and recovery

Run `npm run backup:verify` with `DATABASE_URL` set to create and inspect a restricted custom-format PostgreSQL backup. A full restore drill additionally requires a separate empty verification database in `RESTORE_DATABASE_URL` and `RESTORE_CONFIRM=YES`. See [docs/BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md). Database backups do not include private vision files.

## Release status

This repository contains an active development branch and a draft PR. The branch must pass a real Prisma validation, type check, test suite and production build. GitHub has created the workflow jobs but has not assigned hosted runners in the observed attempts (runner_id 0, empty runner name, no steps or logs). A manual retry reproduced the same runner-assignment failure. Public GitHub Status reports Actions operational, so the cause is not identified from the available repository metadata. No code-level CI result has yet been produced. A reviewed database migration, backup/restore drill, authentication review, operational acceptance tests and production walkthrough are required before merge or deployment. See the current draft PR for the precise integration state.

## Important deployment note

The repository contains the application and database layer, but production deployment still requires PostgreSQL, environment variables, HTTPS, backups, authentication configuration, durable image storage, and operational monitoring.

## Design, build and run handoff

Start with [docs/FLOCKENCE_DESIGN_AND_BUILD_HANDOFF_2026-11-01.md](docs/FLOCKENCE_DESIGN_AND_BUILD_HANDOFF_2026-11-01.md): how to run everything, where the design system and photos live, camera service notes, pitfalls and open work. Brand and Oriya notes are in [docs/FLOCKENCE_REBRAND_HANDOFF_2026-10-31.md](docs/FLOCKENCE_REBRAND_HANDOFF_2026-10-31.md).
