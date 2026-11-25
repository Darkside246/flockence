# Flockence design system

## Audit of the launch branch

| Area | Finding | Change |
| --- | --- | --- |
| Theme identity | Settings, bootstrap and ThemeProvider each defined their own list. Five legacy CSS IDs remain in globals and have no selector entry. | Central registry for the seven supported themes. Browser preferences retain the same keys and IDs. |
| Contrast | Global rules forced muted text on every paragraph, span and label, including content inside buttons and badges. Sol's bright elevated surface shared light foreground values. Crystal used muted blue-grey on glass surfaces. | Removed the broad foreground rule, specified AA-tested solid role pairs, and routed the Crystal variables through the same palette. |
| Shell | Sidebar, mobile drawer and search were styled by overlapping global, premium and Crystal rules. Some navigation labels were truncated. | Shared surfaces, wrapping, selected states, and viewport-bounded search surfaces. |
| Dashboard | The detailed dashboard hero styling was specific to Poultry Farm and Cyber Crystal. | All themes have a bounded hero with wrapping actions. Existing data, navigation and operational workflows are preserved. |
| Appearance | Swatches had separate colours from the actual theme. | Preview cards render from the same palette as the app. Poultry Farm defaults on a clean profile and Free remains restricted by its server-derived membership. |
| Remaining audit | A number of Crystal page decorations and route-specific form, chart and media styles predate the shared contract. | Review rendered screens before removing legacy compatibility aliases. |

## Component contract

Define palette values in `app/theme-system.css`. Each theme declares solid semantic roles for canvas, surfaces, text hierarchy, accent and status, and reusable borders, radius and elevation. The same selector applies palette variables to the Settings preview. Use those roles directly in new components, including `--bg-surface`, `--text-secondary`, `--border-default` and `--border-focus`. Use `--accent-contrast` for text on a solid accent fill and `--text-link` for links on neutral surfaces. Keep meaningful status text visible. Existing legacy tokens resolve to these roles during migration.

The appearance registry is `lib/theme-registry.ts`. IDs are permanent because preferences already reference them. The browser stores presentation choices only. Authorize paid capabilities at the API with trusted membership records. The design system does not grant commercial entitlements.

## Asset register

- Existing Flockence custom navigation and dashboard icons in `components/nav.tsx` and `components/cx-icons.tsx` remain in use. This change adds no icon package.
- Existing locally hosted `hen-chicks.jpg` (Andreas Ebner, Pexels 20118290), `eggs-hands.jpg` (cottonbro studio, Pexels 4911795), and `chick-eggs.jpg` (Nida Kurt, Pexels 8129728) are recorded in [the repository credits](../public/brand/CREDITS.md). The repository records the [Pexels Licence](https://www.pexels.com/license/) and credits the photographers as a courtesy. This change introduces no new photographic asset and makes no request to an external image host.

## Verification

`npm test` verifies solid semantic pairs for normal text, muted and input placeholder text, status text, accent buttons, active navigation text, and meaningful borders and focus. Reference: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). These assertions do not measure every page-specific overlay, chart label or image scrim.

The pull-request visual workflow uses a disposable database and compares base and branch builds. It saves before-and-after desktop (1440 × 1000) and mobile (390 × 844) screenshots for all seven themes on Dashboard, Housing, Flocks, Eggs, Inventory, Reports, Settings and Farm setup. It checks that theme selection survives full navigation and captures available navigation drawers and search dialogs. The report records horizontal overflow. Screenshots still require visual inspection. Tablet, keyboard coverage beyond the smoke checks, real populated charts and a full accessibility review remain independent release checks.
