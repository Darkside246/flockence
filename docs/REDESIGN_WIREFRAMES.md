# Flockence 2026 premium redesign — Phase 2 wireframes and design-system plan

Goal from the owner: **dense but calm**. Less scrolling, smaller headers, compact KPI cards and tight tables, in the spirit of the Ez.Farm, Birdoo and Nexus AI references (structure only; Flockence keeps its own brand, words and data). Every number shown must come from existing APIs; empty states say so plainly instead of inventing values.

Widths: desktop 1440, laptop 1280, tablet 820, mobile 390. Rail 232 px. Content max 1360 px with 24 px gutters (16 px mobile).

## 1. Application shell

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ F Flockence│ Flocks                                          [badge] [⋯]  │  page header 56–64 px
│ [⌕ Search⌘K│ Set up broiler meat flocks and layer egg flocks in one place │  (title 22/28, desc 13)
│            ├──────────────────────────────────────────────────────────────┤
│ OVERVIEW   │  content (max 1360)                                          │
│ ▣ Overview │                                                              │
│ DAILY OPS  │                                                              │
│ ▣ Daily rd │                                                              │
│ ▣ Flocks   │                                                              │
│ ▣ Health   │                                                              │
│ ▣ Vision   │                                                              │
│ PRODUCTION │                                                              │
│ …          │                                                              │
│ ────────── │                                                              │
│ Sign out   │                                                              │
└────────────┴──────────────────────────────────────────────────────────────┘
```

- Rail is flush to the left edge (no floating card), full height, scrolls on its own. Rows 32 px, group labels 11 px caps.
- The page header is the existing `.topbar` markup made visible and compact in every theme (it was hidden in six of seven). Kicker line dropped above the title; badge becomes a small chip at the right.
- Mobile (< 761 px): rail hidden; 52 px sticky top bar with menu, title (one line, ellipsis) and search; bottom bar keeps Dash / Cameras / Flocks / Houses / Search / More; drawer lists the same six groups.

## 2. Navigation groups (every route kept, same role rules)

| Group | Items |
| --- | --- |
| Overview | Overview `/` |
| Daily operations | Daily round `/operations` · Flocks `/batches` · Health `/health` · Farm Vision `/vision` |
| Production | Egg production `/layers` · Pack eggs `/layers/packing` · Planning `/planning` · Trace `/trace` |
| Farm resources | House `/house` · Pens `/pens` · Inventory `/inventory` · Suppliers `/suppliers` · Cameras `/cameras` · Devices `/devices` |
| Insights | Performance `/performance` · Layer performance `/layers/performance` · Reports `/reports` |
| Management | Finances `/finances` · Team `/team` (Owner, Supervisor) · Settings `/settings` |

⌘K / Ctrl-K searches exactly the visible items, so a Farm Hand never sees Team.

## 3. Dashboard (Phase 5)

```
Overview · Thu 27 Nov · 2 active flocks                       [Daily round →]
┌KPI──────┐┌KPI──────┐┌KPI──────┐┌KPI──────┐┌KPI──────┐   5 × 88 px
│Live birds││Losses 7d││Eggs today││Feed 7d  ││Open tasks│
│ 2,940    ││ 4 ·0.1% ││ 612      ││ 210 kg  ││ 3        │
└──────────┘└─────────┘└──────────┘└─────────┘└──────────┘
┌ Needs attention (action queue) ─────┐┌ Today's round ───────────┐
│ • Pen 2 water not recorded   [Open] ││ 6/9 pens checked  ▓▓▓▓░░ │
│ • Vision: litter wet, Pen 4  [Open] ││ next: Pen 7              │
└─────────────────────────────────────┘└──────────────────────────┘
┌ Production 30 days (chart) ─────────┐┌ Mortality 30 days ───────┐
└─────────────────────────────────────┘└──────────────────────────┘
┌ Active flocks (table: flock, type, age, live, losses %, eggs/feed, →) ──┐
└──────────────────────────────────────────────────────────────────────────┘
```
Hero photo panel shrinks to a 120 px strip (theme photography kept; CI asserts it exists).

## 4. Batches / Flocks (Phase 6)
Header actions: `Add flock`. Filter chips: All · Broiler · Layer · Closed. Table: Flock · Type · Pen · Placed · Age · Live · Losses % · Status · ⋯. Row click opens the existing edit dialog. Add form opens in a side panel instead of a full-width card.

## 5. Daily round (`/operations`)
Two-column on desktop: left = pen checklist (compact rows with status chip and "Record"), right = the form for the selected pen. Slaughter / processing / transport move under tabs.

## 6. House and Pens
House: inputs in a 3-column form group, results as an inline data group (density, feeders, drinkers) beside it — no stacked full-width cards. Pens: grid of 160 px pen tiles (name, flock, birds, camera), editor in a side panel.

## 7. Health
Tabs (Overview · New problem · Treatments · Tests) directly under the page header; drop the "Something wrong with the flock?" hero (it repeats the header). Case list as table with severity chip.

## 8. Layers (egg production, packing, performance)
Top KPI strip (hen-day %, eggs today, saleable %, cracked %), then collection form inline (one row on desktop), then 7-day trend and table. Packing: lot table + "Pack" side panel; print label untouched.

## 9. Inventory, Suppliers, Finances
Shared table page pattern: header → filter bar (search, type, location) → table → side panel for create/edit. Finances: KPI strip (revenue, costs, margin, per bird) from existing totals; ledger table.

## 10. Reports and Insights
Report list as cards in a 3-column grid (title, period, export buttons); CSV export buttons grouped in one toolbar. Performance and layer performance use the KPI + table pattern.

## 11. Cameras
Camera wall: 3–4 columns of 16:9 tiles with name/status overlay, toolbar for Live / Stills / Recordings. Connection settings (Owner) in a collapsed section.

## 12. Farm Vision (owner's example)
```
┌ Photo check ──────────────────────────────────────────────────────────────┐
│ [ drop or take photo (160 px) ] │ Category [Pen ▾]  Camera [Outdoor 4 ▾]  │
│                                 │ Batch [Farm-wide ▾] Pen [▾]             │
│                                 │ Notes [_______________________________] │
│                                 │ ☑ Send one new camera image…  (inline)  │
│                                 │ [Analyze photo]  298/300 left this month│
├ What Vision already knows (collapsed one-line summary, expand for detail) ┤
└───────────────────────────────────────────────────────────────────────────┘
Automatic inspections · Findings · Reports → compact cards, two columns
```
Checkbox inline with its text; "Save camera assignment" becomes a secondary text button next to the camera picker; context box collapses to one line. Coordinated with the open `feature/readable-reports-counting` branch (it owns `vision-glance` and `/vision/reports`).

## 13. Settings
Left section list (Account, Appearance, Team, Storage for everyone; farm, integrations, cameras, schedules, email, catalogues for Owner only — current rules unchanged), right content in 720 px column. Theme picker: 4-column grid of 120 px previews; premium lock state unchanged.

## 14. Forms
Labels 13 px above 40 px fields (44 px on touch), two or three columns on desktop, inline checkbox rows, actions right-aligned in a footer row, validation text 12 px under the field. Long forms open in a side panel or dialog rather than pushing the page down.

## Design-system plan (Phase 3)

**Files** (imported in this order by `app/layout.tsx`):

1. `@fontsource-variable/manrope` — self-hosted Manrope, weights 200–800 (we use 400–800).
2. `app/styles/tokens.css` — brand, type, spacing, radius, elevation, layout, motion tokens; component tokens derived from the theme palette.
3. `app/theme-system.css` — unchanged role: one semantic palette per theme (tested for contrast).
4. `app/styles/base.css` — reset, typography, links, forms, buttons, legacy shared classes (`card`, `section-head`, `metric-*`, `row`, `stats`, `badge`, `hero`, `empty`…) rebuilt on tokens. Replaces `globals.css` + `accessibility-theme.css`.
5. `app/styles/components.css` — new `ds-*` components (page header, card, inline data group, KPI, status chip, table, filters, tabs, buttons, fields, empty/loading/error) plus dashboard widgets moved out of `premium.css`.
6. `app/styles/shell.css` — sidebar, page header, content width, mobile bar, drawer, command palette, print labels. Replaces `premium.css` + `premium-fixes.css`.
7. Theme skins kept for now (`crystal*`, `poultry*`, `theme-photography`), minus the shell rules that fought the old navy layer. They are retired page by page in Phases 5+ as pages adopt `ds-*` components.

**Tokens**

| Token | Values |
| --- | --- |
| Brand | Forest `#2E5A12`, Leaf `#7CB733`, Slate `#232B1C`, Harvest `#E0A21E`, Canvas `#F5F6F1` (Leaf and Harvest are fills/charts only — below 3:1 as text on white) |
| Space | `--space-1…8` = 4 / 8 / 12 / 16 / 20 / 24 / 32 |
| Radius | `--radius-xs 4`, `sm 6`, `md 8`, `lg 12`, `xl 16`, `pill 999`; theme `--card-radius` still caps cards |
| Elevation | `--elev-0` none, `--elev-1` card, `--elev-2` raised/hover, `--elev-3` menus, `--elev-4` dialogs — built from each theme's shadow tokens |
| Type | Manrope; 12 / 13 / 14 / 16 / 18 / 22 / 28 px; weights 400 / 500 / 600 / 700 / 800; `font-variant-numeric: tabular-nums` on numbers, tables and inputs |
| Control | height 36 (sm) / 40 (md) / 44 (touch); `data-density="compact"` reduces space tokens one step |
| Layout | `--rail-w 232px`, `--content-max 1360px`, `--gutter 24px` (16 mobile), `--header-h 56px` |

**Rules**: no hard-coded colours in component CSS (only tokens); no new `!important` except where an existing theme skin forces one; free/premium theme rules untouched.
