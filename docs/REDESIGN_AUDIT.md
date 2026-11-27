# Flockence 2026 premium redesign — Phase 0 and Phase 1 audit

Written 27 November 2026 against `origin/main` at `35b998c` (Merge PR #57, team roles). Visual-only programme: no API, route, database, calculation, permission or entitlement changes.

## Phase 0 — safety and baseline

| Check | Result |
| --- | --- |
| `AGENTS.md`, `README.md` | Read. Work through GitHub PRs and VPS deploys; verify on https://flockence.com; no localhost previews for the owner. |
| Live revision | Reported by the owner's session as `35b998c`, WorkingDirectory `/opt/flockence-release-35b998c/app`. `35b998c` is the tip of `origin/main`. This session cannot read the VPS, so the owner should confirm with `sudo -u flockence -H git -C /opt/flockence-release-35b998c/app rev-parse HEAD`. |
| `feature/design-system-rebuild` | **Superseded / complete.** Its tip `9ed3991` (25 Nov, "Match the mobile menu to the theme…") is an ancestor of `main`; it has no commits that are not on `main`. Nothing to salvage. |
| `ux/full-application-experience-refactor` | Unmerged (6 Nov, 5 commits: grouped navigation, Settings Centre, Health hub). Stale against three weeks of `main`; not used as a base. Its grouped-navigation idea is reflected in the Phase 4 groups. |
| `feature/readable-reports-counting` | Open in another session (adds `components/vision-glance.tsx`, `app/vision/reports/page.tsx`, grid counting). This redesign does **not** edit those files or `app/vision/page.tsx` in phases 0–4. The new design-system classes are additive, so that branch can adopt them later without conflict. |
| Branch | `feature/premium-shell-design-system`, cut from `origin/main` `35b998c`. |
| Baseline screenshots | The live site needs the owner's sign-in, which this session cannot enter. Baseline is taken instead by the repository's own **Theme visual review** CI job (`tests/theme-visual.mjs`), which renders `main` ("before") and this branch ("after") for every route in all seven themes at desktop 1440, tablet 820 and mobile 390, with a seeded broiler and layer flock. Evidence is in the PR's `themes-before` / `themes-after` artifacts. The owner's own Farm Vision screenshot (27 Nov) is the reference for the wasted-space complaint. |

## Route inventory

Roles: **Owner**, **Supervisor** (`MANAGER`), **Farm Hand** (`WORKER`), **Read Only** — see `lib/farm-roles.ts`. "All" = any signed-in member; write actions are enforced by the API, the page only hides controls.

| Route | Purpose | Main data (API) | Main actions | Roles that see it / act |
| --- | --- | --- | --- | --- |
| `/` | Farm overview dashboard | dashboard, daily-round, action-queue, lifecycle, procurement, weather | Jump to tasks, daily round, cameras | All |
| `/batches` | Flocks (broiler and layer) | batches, pens, mortality, chick-prices, settings | Add flock, record deaths, edit flock | All; add/edit Owner+Supervisor |
| `/operations` | Daily round + slaughter, processing, transport | batches, slaughter, transport-events | Record operations | All; record Owner/Supervisor/Farm Hand |
| `/layers` | Egg production | batches, egg-collections, flock-ledger, layer-stage | Record collection, grading, stage | All; record roles |
| `/layers/performance` | Layer KPIs per flock | layers/performance | Read only | All |
| `/layers/packing` | Pack graded eggs, print labels | batches, egg-packs, storage-locations | Create pack, print label | Record roles |
| `/house` | House designer (density, equipment) | local calculation only | Plan | All |
| `/pens` | Pen layout | pen-config | Edit pens | All; edit Owner+Supervisor |
| `/health`, `/health/treatments`, `/health/tests` | Health cases, treatments, diagnostics | batches, health/cases, treatments, tests | Open case, record treatment/test | All; record roles |
| `/trace` | Chick-to-sale traceability | batches, trace | Look up lots | All |
| `/cameras` | Live view, stills, recordings | camera service routes | View, connect (Owner) | All; camera settings Owner |
| `/vision` | Farm Vision photo checks, reports, alerts | vision, vision/cameras, pens, usage, compare, research | Run photo check, compare, assign camera | All; checks by record roles; plan limits apply |
| `/devices` | Smart devices and feeds | device gateway routes | Link devices | All; Owner changes |
| `/inventory` | Product lots and storage | inventory, storage-locations, storage-temperature | Receive, move, dispose | All; catalogue Owner |
| `/finances` | Costs and revenue | batches, expenses, orders, settings | Record expense/sale | All; record Owner+Supervisor |
| `/suppliers` | Supplier catalogue | suppliers | Add/edit supplier | Owner edits |
| `/planning` | Production planning, harvest readiness | lifecycle | Read | All |
| `/performance` | Actual flock performance | performance/summary | Read | All |
| `/reports` | Reports and CSV exports | reports, export | Export | All |
| `/team` | Members and invitations | team | Invite, change role | Nav: Owner+Supervisor; invite rules in `canInviteRole` |
| `/settings`, `/settings/plan` | Settings centre, plan | settings, settings/plan | Change settings, theme | Non-owners see only Account, Appearance, Team, Storage |
| `/account` | Own profile and sessions | auth/me | Change name, password, sessions | All |
| `/farm-setup` | First-run farm setup | farm-setup | Set up farm | Owner |
| `/inspections` | Offline inspection queue | offline/inspections | Review queued | All; Owner actions |
| `/design-system` | Theme matrix and component reference | none | none | All (internal reference, not in nav) |
| `/platform` | Platform administrator status | platform-access (server) | none | Platform administrator only (`notFound` otherwise) |
| `/login`, `/signup*`, `/forgot-password`, `/reset-password` | Authentication | auth | Sign in/up | Public |

Navigation currently lists 22 destinations in three groups (Operate 9, Control 8, Understand 2) plus Team and Settings. `/account`, `/farm-setup`, `/inspections`, `/design-system`, `/platform` are reached from links, not the sidebar.

## Component inventory

- **Shell**: `components/nav.tsx` (sidebar, mobile bottom bar, drawer, ⌘K palette, sign-out), `components/auth-gate.tsx` (session, auth card), `components/theme-provider.tsx`, `components/banner-photo.tsx`, `components/pwa-register.tsx`.
- **Every page builds its own shell**: `<div className="shell"><header className="topbar"><div className="brand">…<h1/><p/>…<span className="badge"/></div></header><Nav/><main className="main">`. 28 pages repeat this markup; there is no shared page-header component.
- **Dashboard**: `dashboard-hero`, `farm-briefing`, `env-widgets`, `production-panels`, `task-panel`, `camera-wall`, `flock-numbers`, `flock-timeline`, `dashboard-settings` (classes `cx-*`, `pipe-*`, `donut`, `finance-bars`).
- **Records and forms**: `daily-flock-check-form`, `flock-edit-dialog`, `slaughter-form`, `processing-pack`, `feed-used`, `feed-type-picker`, `feed-settings`, `supplier-picker`, `manure-panel`, `food-safety-checklist`, `type-to-confirm`, `health/*`, `health-styles`.
- **Farm Vision**: `vision-report`, `vision-findings`, `vision-intelligence`, `vision-known`, `vision-alerts`, `vision-daily-report`, `vision-detector`, `vision-people`, `vision-schedule`, `pen-layout` (+ `vision-glance` on the other session's branch).
- **Cameras and devices**: `camera-wall`, `camera-gateways`, `camera-connection-controls`, `blink-settings`, `settings-camera-providers`, `wyze-bridge-link`.
- **Account**: `account-*`, `auth-form`, `free-signup-form`.
- **Shared visual classes used most** (counts in `app/**/page.tsx`): `card` 224, `section` 126, `button` 100, `section-head` 90, `grid2` 62, `badge` 48, `muted` 46, `metric-value` 43, `hero-kicker` 43, `metric-label` 41, `form` 36, `metric-card` 33, `button-primary` 31, `empty` 30, `row` 25, `stats` 14. These are the levers: restyling them through tokens changes every page at once.

## Theme architecture

- `lib/theme-registry.ts`: seven themes — **Poultry Farm** (free, default), **Cyber Crystal**, **Aero Glass**, **Heritage Sovereign**, **Field Workhorse**, **Sol Tactical**, **Terra Flora** (premium).
- `components/theme-provider.tsx`: free farms are forced to `poultry` (`freeAppearance`); premium choice, density (`comfortable|compact`) and radius (`soft|sharp`) are stored per account in `localStorage` and mirrored to `html[data-theme|data-density|data-radius]`. `app/layout.tsx` restores the choice before first paint.
- **Palette source of truth**: `app/theme-system.css` defines one semantic palette per theme (`--bg-canvas`, `--bg-surface*`, `--text-*`, `--accent-*`, `--border-*`, `--status-*`, `--card-radius`, `--surface-blur`, `--shadow-*`), then maps two older vocabularies onto it (`--bg/--ink/--primary…` from `globals.css`, `--surface-canvas/--text-on-card…` from `accessibility-theme.css`, `--app-*` from `premium-fixes.css`, `--cx-*` for Crystal). `tests/theme-contrast.test.mjs` checks every palette against WCAG AA.
- Poultry Farm is redefined three times (`theme-system.css`, `poultry.css`, `poultry-refinement.css`), with different accent greens (`#285b3a`, `#285332`, `#285b3a`). Crystal is redefined in `crystal.css` after `theme-system.css`.

## CSS architecture and where the cascade conflicts come from

All sheets are global and imported by `app/layout.tsx` in this order (bytes / `!important` count):

| # | Sheet | Bytes | `!important` | Role |
| --- | --- | --- | --- | --- |
| 1 | `globals.css` | 13.8k | 0 | Original light UI + five **dead** themes (`aurora`, `midnight`, `harvest`, `ivory`, `graphite`) no longer in the registry |
| 2 | `accessibility-theme.css` | 5.1k | 35 | Forces 48 px minimum height on every button/input/nav link, 16–17 px body type |
| 3 | `premium.css` | 16.1k | 2 | Floating rounded sidebar (244 px), 162 px metric cards, 28 px-radius heroes, decorative blobs |
| 4 | `premium-fixes.css` | 18.8k | 60 | "Command-centre" **navy** repaint of `.shell`, **hides every page's `.topbar`** (`.shell .topbar{display:none}`), second sidebar width (238 px), layer charts, print labels |
| 5 | `vision/vision.css` | 8.6k | 0 | Farm Vision layout |
| 6 | `auth.css` | 1.9k | 0 | Sign-in card |
| 7–10 | `crystal.css`, `crystal-depth.css`, `crystal-pages.css`, `crystal-photos.css` | 43.5k | 151 | Crystal-only skin; also the only theme that re-shows the page title bar |
| 11 | `poultry.css` | 4.1k | 0 | First Poultry Farm skin |
| 12 | `theme-system.css` | 16.3k | 13 | Semantic palettes for all seven themes + nav/drawer/palette repaint |
| 13 | `theme-photography.css` | 5.1k | 8 | Photo grading per theme |
| 14 | `poultry-refinement.css` | 14.6k | 55 | Second Poultry Farm skin; undoes the navy repaint with `!important`; adds 76 px top padding to `.main` |
| 15 | `farm-records.css` | 10.0k | 4 | Records pages |
| – | `camera-recordings.css`, `farm-setup/setup.css` | 7.8k | 4 | Page-imported |

Total ≈ 173 kB of CSS, ~330 `!important`. Root causes:

1. **Paint-then-repaint**: sheet 4 paints the whole app navy; sheets 7–14 repaint it per theme with `!important`. Any new rule has to out-shout both.
2. **Four vocabularies of colour variables** (`--bg/--ink`, `--surface-canvas/--text-on-*`, `--app-*`, `--cx-*`) bridged in `theme-system.css`; hard-coded hex values (`#dfe8dc`, `#e8f5f0`, `#f7ebda`, `rgba(255,255,255,.93)`) in `premium.css` ignore the theme entirely.
3. **Three sidebar definitions** (`globals` horizontal pill bar, `premium` floating 244 px card, `premium-fixes` full-height 238 px) and three mobile treatments (bottom tabs from `premium`, hamburger + search buttons from `premium-fixes`, Crystal `.bottom-nav`).
4. **Page titles hidden in six of seven themes** (sheet 4), so pages compensate with in-page `.hero` banners (e.g. Health repeats "Flock Health" as "Something wrong with the flock?").
5. **Accessibility layer applied globally**: 48 px minimum on *every* control and link, including chips and table buttons — the main reason forms and toolbars look sparse.
6. **Specificity escalation** for Poultry (`html[data-theme="poultry"] .shell .button` + `!important`) means component styles cannot be changed without touching the theme sheet too.

## Repeated information

- Page title and description exist in every `.topbar` but are hidden; pages then add a `.hero` with a second headline (Health, Vision, Dashboard).
- Topbar badges repeat the page purpose in capitals ("ACTUAL DATA", "LAYER WORKSPACE", "AI VISION").
- Brand block appears in the sidebar, drawer, auth card and the Vision title bar (`brand-mark` "F").
- The sidebar footer showed a hard-coded "Alchemy Farms • Poultry OS / Production cockpit" (`premium.css` `.nav::after`, now hidden by `theme-system.css`) plus a "Farm workspace" status chip.
- Farm Vision: plan usage, camera assignment and "What Vision already knows" restate information that also appears in reports and the Camera tab.

## Visual problems and specific fixes

| Problem | Where | Fix (phase) |
| --- | --- | --- |
| Wasted vertical space: 162 px metric cards, 28–30 px card padding, 44–52 px hero headings | `premium.css`, `globals.css` | Token spacing 4–32, KPI min-height removed, card padding 16 (12 compact), H1 22 px (3) |
| Every control ≥ 48 px, labels 16 px | `accessibility-theme.css`, `poultry*.css` | Control height token 40 px desktop / 44 px touch; 44 px kept on coarse pointers and mobile (3) |
| Checkbox labels stacked as grids, leaving half-row gaps (owner's Vision screenshot) | `globals.css` `label{display:grid}` | Inline check/radio rows via `label:has(> input[type=checkbox])` (3) |
| No visible page title in six themes; 76 px dead band above content | `premium-fixes.css`, `poultry-refinement.css` | Compact page header from the existing `.topbar` markup in every theme (4) |
| Sidebar 238–244 px, floating card with 18 px gutters, 46 px links | `premium*.css` | Flush 232 px rail, 32 px rows, six task groups (4) |
| Inconsistent greens for Poultry (`#285b3a`/`#285332`) and gold accents | three poultry sheets | One Forest/Leaf/Harvest brand scale (3) |
| Content width unbounded on wide screens, ragged on tablets | `.main` rules ×4 | `--content-max: 1360px`, 24 px gutters, 16 px on mobile (4) |
| Inter declared but never loaded (system fallback) | `globals.css` | Self-hosted Manrope 400–800 with tabular numerals (3) |
| Decorative radial blobs, dotted noise overlay, hover lift on every card | `globals.css`, `premium.css` | Removed; hover only on interactive cards (3) |
| Tables differ per page (grid `.row`, `<table>`, `layer-*-table`) | many | Shared `.ds-table` and `.row` density tokens (3); page adoption (5+) |

## Unused or suspect selectors

Static scan of class names present in CSS but absent from `app/`, `components/`, `lib/` source. Several are built dynamically and **must not** be deleted on this evidence alone (`finding-*`, `status-*`, `briefing-*`, `is-*`). Confirmed dead with the source: the floating appearance control (`appearance-*`, removed from React in the November refactor), `hero-dashboard`, `status-panel`, `status-pill`, `profile-*`, `search-box`, `kpi-trend`, `trend-line`, `nav-logout`, `theme-swatch`, the five legacy theme palettes. These are dropped in Phase 3 with the sheets that held them.

## Regression risks

- **Theme contrast tests** read `theme-system.css` and `poultry-refinement.css` by path and regex; palettes must stay in `.theme-preview[data-theme=…]` blocks and Poultry overrides must stay theme-scoped.
- **Visual CI** (`tests/theme-visual.mjs`) clicks "Search Flockence", "Open menu / More destinations", "Find anything"; checks drawer labels ≥ 80 px wide, no horizontal overflow, the dashboard photo panel and seeded totals. Accessible names must be kept.
- **Free vs premium appearance**: only `poultry` for free farms (`freeAppearance`); must not change.
- **Role-based nav**: Team only for Owner/Supervisor (`canManage`). Settings sections are filtered in the Settings page itself, not by CSS.
- **Print label** for egg packs relies on print-only rules in `premium-fixes.css`; must be carried over verbatim.
- **Crystal** depends on `.topbar:has(> .bottom-nav)` and its own sheets; it is the most heavily customised theme and the likeliest to regress.
- **Other open branch** (`feature/readable-reports-counting`) touches Vision files; global class changes (`.card`, `.section-head`) will also restyle its new pages.
- **48 px → 40 px controls** on desktop: keep ≥ 44 px on touch (coarse pointer) and on mobile widths for WCAG 2.5.8 / farm gloves use.

## Results after phases 3–4 (CI Theme visual review, run 46075251254)

- 512 screenshots per side: 23 routes × 7 themes × desktop 1440 / tablet 820 / mobile 390, plus navigation and search.
- Horizontal overflow: **10 cases on `main` → 0**. On `main`, `/vision` overflowed on phones in Crystal, Workhorse and Terra (others are listed in the PR's `themes-before/report.json`). The fixes, all in the shared layer:
  - `.table-scroll` had no styles at all; it now scrolls.
  - Labels and form controls may shrink in grid tracks.
  - `.stats` uses auto-fit columns.
  - Dashboard section heads wrap their buttons.
- Page height, summed over all routes and themes: desktop −7.0%, tablet −6.1%, mobile −3.9%. This is measured with page titles now visible in every theme, which adds height. Poultry Farm examples: Flocks 1805→1372 px, Farm Vision 3311→2617, Dashboard 6410→5417, House 1220→1000. Bigger reductions need the page redesigns in Phase 5 onwards (the dashboard alone is 5,400 px).
- The CI harness itself had drifted from the app and was fixed. It now:
  - sends the site `Origin` with its sign-up (required by `lib/account-form-security.ts`);
  - opens `/settings#appearance` to reach the theme picker;
  - names the offending elements when the overflow check fails.

### Pre-existing gaps found during review (unstyled on `main` too; for the page phases)
- `/house` and `/pens` "Recommended layout": `.house-plan` / `.house-cell` have no CSS, so the letter badges run into their labels ("FFeed").
- Farm Vision report areas: `.vision-intel-area-status` has no CSS, so the status runs into the area name ("Insufficient dataLitter").
- The dashboard is about 5,400 px tall on desktop, about 7,300 px on tablet.
