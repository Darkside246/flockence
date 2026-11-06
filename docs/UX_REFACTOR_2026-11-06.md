# Flockence UX and information-architecture refactor (2026-11-06)

Branch `ux/full-application-experience-refactor`, from `main` at `e6788fb`. Not merged.

## Where things live now

`lib/nav-config.ts` is the single source for the sidebar, mobile drawer, search palette, breadcrumbs and the tab row
under the breadcrumbs. Add a page there and it appears everywhere. A page belongs to one category.

| Category | Pages |
| --- | --- |
| Workspace | Overview `/`, Daily Round `/daily-round`, Tasks `/daily-round?tab=tasks` |
| Production | Flocks `/batches`, Layer Production `/layers`, Egg Packing `/layers/packing`, Layer Performance `/layers/performance`, Production Planning `/planning`, Harvest & Processing `/harvest` |
| Farm Management | Housing `/house`, Pens `/pens`, Flock Health `/health`, Food Safety `/food-safety`, Cameras `/cameras`, Farm Vision `/vision` |
| Business | Inventory `/inventory`, Finance `/finances`, Transport `/transport` |
| Insights | Performance `/performance`, Traceability `/trace`, Reports `/reports` |
| Administration | Team `/team` (owner and manager), Settings `/settings` |

Old addresses redirect (permanent): `/operations` to `/daily-round`, `/health/tests` and `/health/treatments` to the
matching tab of `/health`. They are listed in `next.config.mjs` and checked by `tests/nav-config.test.mjs`.

## Daily Round (`/daily-round`)

Today's progress (which flocks are checked, deaths today, heat signs, treatment holds), then three tabs:
**Today's checks** (the daily flock check, weights and deaths), **Tasks**, **History** (latest 100 checks).
The extracted workflows keep their existing forms and APIs:

- slaughter, processing and by-products: `/harvest` (`components/processing-pack.tsx`, `components/manure-panel.tsx`)
- journeys and cold chain: `/transport`
- food-safety checklist: `/food-safety`
- weights and deaths form: `components/flock-records.tsx`

Record dates cannot be in the future in the forms (`max` is the farm's own today); the server already refuses them.

## Flock Health

One hub at `/health` with URL tabs (Overview, New problem, Treatments, Tests). The treatment and test forms from the
two old sub-pages are now `components/health/treatments-panel.tsx` and `tests-panel.tsx`, shown in their tab above the
list of records. There is one implementation of each.

## Settings Centre (`/settings?section=...`)

Farm profile, Production, Housing & equipment, Health & biosecurity, Inventory & storage, Sales & finance,
Devices & integrations, Appearance & accessibility. Farm sections need an owner or manager (the server also refuses
`PUT /api/settings` for anyone else); Appearance is per device. Settings that already have a working home (pen
profiles, storage locations, lifecycle targets) are linked, not copied, so there is one authoritative place for each.
`GET /api/settings/integrations` (owner and manager) reports only connected or not, never a key or address.

Known gap: the House Designer still keeps its inputs in the browser (`chicken-op-house-config`). Moving them to the
settings table is straightforward but changes stored data, so it was left for its own change.

## Design system (`app/ui-system.css`, loaded last)

- Buttons: **primary** (teal gradient: `.button-primary`, `.primary`, `.btn-primary`, and any plain submit button in
  a form), **secondary** (`.button`, `.btn-secondary`), **tertiary** (`.btn-tertiary`), **destructive** (`.btn-danger`).
  One height (42px), radius, focus ring and disabled state; `.btn-row` / `.form-actions` give wrapping rows with a gap.
- Inputs and selects: one height, dark glass fill, custom chevron, teal focus ring. Native `<select>` is kept for
  keyboard and screen-reader behaviour and correct placement.
- Page layout: Cyber-Crystal banner (title and one-line purpose), breadcrumbs, category tabs, then content.
- The floating appearance button was removed; it overlapped content and duplicated Settings > Appearance.

## Two defects fixed on the way (they blocked recording on a fresh database)

1. `lib/poultry-lock.ts`, signup and team used `$queryRaw` for `pg_advisory_xact_lock`, whose `void` result Prisma
   cannot read. Every record that takes the flock lock (daily check, mortality, weight, slaughter, transport,
   treatment, egg collection, pack, sale) failed. Now `$executeRaw`.
2. The farm-scope link check (`lib/prisma.ts`) looked up a parent row on another connection, so writes pointing at a row
   created earlier in the same transaction (a new flock's first bird count, graded egg lots) were refused as
   `LINK_OUTSIDE_FARM`. It now also accepts ids this request created through the scoped client.

## Not done

- Searchable selects for very long lists, and a shared select component: selects are styled natively.
- No Playwright suite exists in the repo; browser checks were run by hand and by script (see the PR description).
- Per-page tidying beyond the shared layout (for example splitting Finance into purchases, expenses, sales and
  orders views) is not done.
