# Poultry Farm visual refinement

Review branch: `feature/poultry-farm-refinement`, based on `feature/design-system-rebuild` at `9ed3991`. This changes only Poultry Farm presentation. No business logic, permissions, membership rules, database schema or production data changed. No deployment was performed.

## Visual inconsistencies found

Legacy command-centre styles hard-coded navy list rows, nearly white statistics, blue supporting text and cyan accents. Shared Crystal dashboard classes also leaked glowing metrics, cyan camera viewfinders, grey production tiles and pale empty states into Poultry Farm. Search overlapped the first content panel. The final mobile review also found drawer labels inheriting an 18px icon width and a hamburger overlapping the drawer header; both are corrected only in Poultry Farm. The supplied Design principles and Farm members defects were reproduced in the baseline application.

## Components changed

The late-loaded `app/poultry-refinement.css` is explicitly scoped to `html[data-theme="poultry"]`, including its responsive and reduced-motion rules. It covers cards and nested panels; statistics; member/list rows; operational forms; native selects and disabled controls; primary and secondary buttons; badges and status chips; active and hover navigation; mobile drawer; global search dialog; appearance controls; dashboard KPIs; production tiles; chart bars, rings and timelines; camera frames and skeletons; empty states; dashboard photographic blending and mobile cropping. Existing routes and component structures remain intact. The shared palette file changes only its Poultry Farm/default block.

## Colour and typography

| Role | Value |
| --- | --- |
| Canvas / secondary surface / card | `#F5F6F1` / `#EDF2E9` / `#FFFFFF` |
| Heading / primary action | `#193F2C` / `#285B3A` |
| Primary / secondary / muted text | `#202923` / `#536258` / `#5B695E` |
| Harvest accent / soft amber | `#C58B32` / `#F3E7CC` |
| Decorative border / control border | `#DCE4DA` / `#6C7B6B` |
| Chart series | forest `#285B3A`, sage `#5C795C`, amber `#996619`, neutral `#68766C` |

System sans stack with Inter and Segoe UI fallbacks. Page and section headings use 700, card titles and controls 600, navigation 550, body and supporting text 450. Numeric metrics retain tabular numerals. Ordinary metrics no longer inherit Crystal text glow. The hero alone retains a subtle light text highlight. Layered green-tinted card shadows and stronger elevated-menu shadows establish depth without blur.

## Photographs and icons

No new photographs, fonts or icon libraries were added. Existing locally hosted photographs were retained, with Poultry Farm-specific grading, edge blending and responsive crops. Existing custom Flockence icons remain in use.

- Dashboard: `public/brand/hen-chicks.jpg`, Andreas Ebner, Pexels asset 20118290. Original asset reference: https://www.pexels.com/photo/20118290/ (the page was unavailable through the research tool on this review; attribution comes from the existing repository register).
- Setup: `public/brand/poultry-housing.webp`, Emma Cate, [Hens in the Chicken Coop](https://www.pexels.com/photo/hens-in-the-chicken-coop-19972937/). Existing 940-pixel WebP, approximately 26 KB.
- Licence: [Pexels License](https://www.pexels.com/license/), which allows free use and modification, including websites and apps, subject to its restrictions. Source and licence register: `public/brand/CREDITS.md`. No watermarked asset was introduced.

## Before and after

Baseline images were captured from the unmodified branch in development mode; final images use the authenticated production build and a disposable database. Data loading, greetings and the local development identity can therefore differ; compare presentation rather than those values.

| Screen | Before | After |
| --- | --- | --- |
| Settings and Design principles | [Before](review/poultry-before-settings.webp) | [After](review/poultry-after-settings.webp) |
| Team and Farm members | [Before](review/poultry-before-team.webp) | [After](review/poultry-after-team.webp) |
| Dashboard | [Before](review/poultry-before-dashboard.webp) | [After](review/poultry-after-dashboard.webp) |
| Mobile dashboard | — | [After](review/poultry-mobile-dashboard.webp) |

## Contrast validation

- All 66 Node unit tests passed, including the existing seven-theme palette suite and eight additional Poultry Farm tests.
- 52 additional colour combinations passed: text at least **4.718:1**, meaningful control boundaries/focus/chart marks at least **3.654:1**. Decorative card borders are intentionally subtler and are not used as the sole control boundary.
- axe-core rendered contrast checks on Dashboard, Settings, Team, Pens, Batches, Layers, Inventory, Reports, Operations, Health and Farm setup reported **zero violations**. Each screen also had an incomplete colour-contrast result requiring manual review (for example gradient surfaces); this is not a claim of complete WCAG certification. Hero text remains on its solid text-safe side, outside the photograph.
- Production browser check confirmed a visible 3px keyboard focus outline.

## Desktop, tablet and mobile visual checks

Actual Chromium captures covered all 24 internal routes at 1440×1000, 820×1180 and 390×844: 72 final route screenshots, plus search and navigation captures. The routes include dashboard, settings, team, pens, farm setup, batches, inventory, layers, reports, daily operations, performance, health, treatments, diagnostics, egg packing, layer performance, housing, finances, planning, traceability, account, cameras, vision and the design-system review page. No page errors, unexpected redirects or horizontal overflow were recorded in the final capture report.

The final desktop review sheet, full Team and Settings screenshots, and complete mobile dashboard and Team screenshots were visually inspected. Additional populated screenshots cover dashboard, batches, layers, reports, operations and pens on desktop and mobile using explicitly labelled test-only fixtures. Dashboard totals reconciled to 99 broilers and 80 layers. These fixtures were seeded directly into the disposable database after the API smoke-test issue below; they do not validate successful flock creation through the UI.

A production-browser isolation check compared styles with Poultry Farm-specific rules present and removed: zero differences across 7,470 elements in six other themes on Dashboard and Settings, excluding the intentionally updated Poultry Farm preview and dynamic status chips. Other themes' palette declarations and CSS files were not edited. This is a scoped-style isolation check, not a full visual certification of those themes.

Interaction checks passed: owner-role lock, keyboard search open/close, visible focus, saved theme after reload, restoring Poultry Farm, and mobile drawer opening with destination labels at least 80px wide and the underlying hamburger hidden. Existing appearance preference storage and Premium restrictions were not changed.

## Build and regression checks

| Check | Result |
| --- | --- |
| Node 22 production build | Passed |
| TypeScript `tsc --noEmit` | Passed |
| Prisma schema validation and client generation | Passed |
| Node unit tests | 66/66 passed |
| Database isolation regressions | 13/13 passed, disposable database only |
| `git diff --check` | Passed |
| Production browser interactions | 5/5 passed |
| Flock-creation API smoke | **Failed: `LINK_OUTSIDE_FARM`**, see below |

The repository browser harness now accepts `VISUAL_ORIGIN` and `VISUAL_THEMES`, captures full pages and tablet views, and covers the additional operational routes. CI screenshot jobs are enabled for this feature branch. Local evidence was collected with an equivalent temporary runner; remote CI status is reported separately by the PR and is not represented here as already passed.

## Unresolved findings and limits

1. `POST /api/batches` returned HTTP 400 with `LINK_OUTSIDE_FARM` during the disposable-data smoke test. The API and farm-scope implementation are unchanged by this PR. The transaction's child-link validation should be investigated separately; this change does not weaken that validation. Populated screenshots used database-only fixtures, clearly named `VISUAL TEST`.
2. No camera service, weather API key or physical sensors were configured in the isolated environment. Their readable unavailable/empty states were reviewed; live video, external weather and sensor integrations were not exercised.
3. axe-core's incomplete contrast findings still warrant a broader manual accessibility review, including platform-native date/select popups and assistive technology. Native controls were checked in Chromium; operating-system popup internals were not separately screenshot-tested.
4. No new image was added. The existing dashboard asset's credit and licence were preserved; its original Pexels page could not be re-fetched during this review.
5. Production deployment and merge remain outside this draft PR.
