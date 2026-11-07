# Farm personalisation, feed recording and speed (2026-11-07)

## 1. Problems found

| Area | What was wrong |
| --- | --- |
| Suppliers | A supplier was only a name, phone and notes. No kind (hatchery, feed dealer, vet), no contact person, WhatsApp, email or location, no way to switch one off, and only the flock form could add one on the spot. |
| Feed catalogue | The Pinnacle and Super Feeds list was written into the code. It could not be renamed, added to, switched off or linked to dealers, and had no bag sizes. |
| Feed purchases and use | Purchases saved the feed as free text. Feed used could only be entered in kilograms, inside the daily flock check, so "1 bag", scoops, pans and pounds all had to be worked out by hand first. |
| Pens | Orientation was free text ("East-West"). There was nowhere to record house number, capacity, poultry type, floor, ventilation, cooling or lighting. |
| Farm profile | Currency was reset to BBD on every save. There was no owner, location, usual bag size, usual breed or usual way of counting feed. |
| Dashboard | Sixteen sections, all always shown and all always loaded, with no plain-language summary of what needs doing. |
| Speed | See section 6. |
| Migrations | The repository has no migration history (see PRODUCTION_DATABASE_MIGRATION_BASELINE.md). |

## 2. and 3. Personalisation added

- **Suppliers page** (Production, Suppliers): categories (chicks and hatcheries, feed dealers, medicine and vet supplies, bedding, equipment, processing, transport, other, plus any kind the farm types), business name, contact person, phone, WhatsApp, email, location, what they supply, notes, and active or inactive. Search and filter by kind. Inactive suppliers stay on old records.
- **Supplier picker** used on feed purchases ("Feed dealer"), expenses ("Paid to") and feed products: type to find; if not found, one tap adds it with just the name. Adding a name that already exists returns the existing supplier instead of a duplicate. Choosing a supplier is always optional. Workers can quick-add; only owners and managers can edit.
- **Feed catalogue** (Settings, Feed: catalogue and measures): the built-in list is copied into the farm's own catalogue the first time it is opened. Every feed name already used on a purchase or feed record is added too, and those purchases are linked to it. Nothing is deleted or renamed. The farm can rename, add, set the usual bag size, choose a preferred dealer, link several dealers to one feed, and switch feeds off.
- **Farm profile** (Settings, Farm details): owner, location, currency (now kept), usual bag size, how you usually count feed out, usual breed (pre-filled on new flocks), and the feed-in-store warning level in days.
- **Pens**: house number, capacity, poultry kept, floor, ventilation, cooling and lighting, all as dropdowns with "Not recorded". Orientation is now two compass dropdowns: which way the long side runs (4 choices) and which way the entrance faces (8 directions). An old free-text "East-West" becomes the matching choice. Anything else is shown as "Previously written as…" and nothing is lost.

## 4. Feed measurement and recording

How feed is **bought** stays apart from how it is **used**. A purchase is bags of a size at a price per bag. Use can be counted in:

| Way of counting | Converted to kg with | If the size is not known |
| --- | --- | --- |
| Bags (full or part: ½, 1½…) | the feed's bag size, else the farm's usual bag size, else the last bag size bought | refused, with where to set it |
| Kilograms, grams | itself | |
| Pounds | × 0.45359237 (exact) | |
| The farm's own measures (scoop, pan, feeder fill, bucket) | the weight the farm entered for one | refused: "Flockence does not know how much one … holds" |

- **Feed used** card (Daily Rounds, Flock records): flock, feed, way of counting, amount, date. ½, 1, 1½ and 2 bag buttons save in one tap. It remembers the last flock and way of counting, and shows the kg before saving.
- The daily flock check takes the same units for "feed put in the feeders".
- Every record keeps the kilograms and what was typed (for example 3 × Red scoop), so totals always work, whatever mix of methods is used.
- Per flock: total kg, bags, cost (from the latest purchase price of that feed), kg per bird placed, and grams per bird per day (from the actual live birds each day). Feed conversion is shown only when birds were weighed on two days, with its method stated. Otherwise the screen says what is missing. Entries made by mistake can be removed by an owner or manager. Retries never double-save.

## 5. Dashboard and page organisation

- **Today on your farm** (first on the dashboard): short sentences from the records, most urgent first, each with a next step. It covers:
  - each flock's age, and for broilers its days to the planned slaughter age;
  - losses in the last 7 days;
  - feed used so far, in bags and with its cost;
  - today's daily check not recorded;
  - eggs today, or "no collection recorded";
  - withdrawal still running;
  - health cases past their review date;
  - feed in the store against the farm's own warning level;
  - the last feed purchase.

  Broiler farms see no egg lines, and layer farms see no slaughter-age lines. Warnings, then up to 4 other lines; the rest are one tap away.
- **Choose what the dashboard shows** (Settings, Dashboard): 16 sections, all on by default. Hidden sections are not loaded at all. The choices come with the sign-in check, so no extra request is needed.
- **Places**: Suppliers has its own page. Feed catalogue and measures, the farm profile and dashboard choices are under Settings. Feed used and Feed and water are in Daily Rounds.

## 6. Speed: measured, then fixed

Measured on a production build with a test database holding a year of records (11 flocks, 741 daily checks, 741 feed entries, 124 losses, 159 egg collections, 120 sales and 200 expenses). Timings are on this computer (localhost), median of 3.

| | Before | After |
| --- | --- | --- |
| `/api/dashboard` (server) | 112–255 ms | 71 ms |
| Dashboard figures on screen (browser) | 1.52 s | 0.67 s |
| Whole dashboard loaded (browser) | 1.52 s | 0.89 s (with the new briefing added) |
| Banner photos | 1,034 KB | 684 KB |
| Pages (HTML) | 17–26 ms | 10–16 ms |

What was done:
1. **Dashboard totals** are summed by the database (group by flock) instead of loading every feed entry, death and purchase of every flock ever kept, which grew each year. The figures are identical: checked by comparing the old and new API output on the same data.
2. **Main figures first.** The dashboard asks for its main figures first and the rest (weather, flock timeline, feed buying, action queue) once those arrive. The browser only runs a few requests at once, so before, the main figures waited behind the others.
3. **Hidden sections are not loaded** (section 5).
4. **Indexes** on feed purchases (farm, date), weighings (flock, date) and stock by store, all queried often.
5. **Photos** re-compressed at the same size (1600 px wide).
6. **Build on small machines:** `NEXT_BUILD_CPUS=1 npm run build` builds with one worker on a machine short of memory.

**Probably the biggest cause of slowness on your machine: `npm run dev`.** The development server compiles each page the first time it is opened (measured 5.0 s for Daily Rounds) and runs much more code on every request. For everyday use, run the production build:

```
npm run build
npm run start
```

Not changed, on purpose: no caching of farm figures (stock, birds and money must never be stale), and camera polling stays (every 30 s, only while the tab is visible). The live video player (hls.js, 567 KB) was already loaded only when a live camera is opened.

## 7. Database changes and affected parts

All additive. `docs/migrations/2026-11-07_flock-ledger_feed_water_suppliers.up.sql` covers every change since commit cfb9947 (this round and the two before it), and the `.down.sql` undoes it. The undo deletes the data in the new tables and columns; read its warning first.

This round:
- **Supplier:** gains category, business name, contact person, WhatsApp, email, location, products supplied, active, and created/updated dates.
- **New tables:** FeedProduct, FeedProductSupplier, FeedMeasure.
- **FeedPurchase:** gains `feedProductId`.
- **FeedUsage:** gains `feedProductId`, `enteredQuantity`, `enteredUnit` and `penId`.
- **Expense:** gains `supplierId`.
- **Indexes:** three new ones.

Farm isolation covers every new table: farm-scope adds the farm to every query and checks every linked id.

**New pieces:**
- **Routes:** `/api/feed-products`, `/api/feed-measures`, `/api/feed-usage`, `/api/farm-briefing`.
- **Changed routes:** `/api/suppliers`, `/api/feed`, `/api/expenses`, `/api/settings` (currency), `/api/auth/me` (dashboard choices), `/api/pen-config`, `/api/daily-flock-check` (feed units), `/api/feed-ledger` (summary).
- **Libraries:** `lib/feed-catalogue.ts`, `lib/feed-entry.ts`, `lib/farm-briefing.ts`, `lib/pen-profile.ts`, `lib/suppliers.ts`, `lib/dashboard-sections.ts`.
- **Components:** `SupplierPicker`, a rewritten `FeedTypePicker` that reads the catalogue, `FeedUsed`, `FeedSettings`, `DashboardSettings`, `FarmBriefing`, and the Suppliers page.

## 8. Tests

- **Unit tests:** 117 pass. 35 are arithmetic in `tests/farm-engine.test.mjs`, including feed units: 1, 2, ½ and 1½ bags of 30 kg; kg, g and lb; a scoop only with its weight.
- **Database tests:** 14 pass. 3 are new in `tests/feed-catalogue.db.mjs`:
  - two first-time catalogue openings at once give one catalogue;
  - old purchases are linked to their feed;
  - another farm cannot see or point at the feeds, measures or suppliers;
  - bag sizes come from the feed first, then the farm.
- **Acceptance checks from the brief:** 47, through the real API on a throwaway database with a year of records and a second farm, all passing after one fix (an invalid pen direction cleared the saved one; now it keeps it). They cover:
  - suppliers: add, edit, own kind, no duplicates, quick add by a worker, workers cannot edit, other farm cannot see or edit;
  - purchases: existing or new dealer, catalogue feed, retry-safe;
  - feed used: 1, 2 and ½ bag of 30 kg; kg; lb; a 25 kg bag; a pan; a scoop refused until weighed; totals, bags, cost, per bird per day and feed conversion only from weighings; retry-safe;
  - daily check: 1½ bags = 45 kg;
  - pens: create, edit, old text converted, invalid direction kept out;
  - dashboard: broiler versus layer lines, missing checks said plainly, hidden sections, currency;
  - the faster dashboard: identical figures to the old code on the same data.
- **Earlier checks re-run on this code:** bird ledger and corrections (37) and feed, water, eggs and slaughter (31), all passing.

## 9. Limitations

- There is no vaccination record in Flockence, so the dashboard cannot say "a vaccination is due".
- The farm profile has no "measurement preference" that changes how weights are shown. Weights are stored and shown in kg, while feed can be entered in pounds.
- The daily flock check's leftover, spilt and returned feed fields are in kg only.
- The daily check only turns feed into a feed-use record (with cost) when at least one feed purchase exists, as before. The quick "Feed used" card has no such limit.
- Dashboard choices apply the next time the dashboard opens, not instantly in other open tabs.
- Timings were measured on this computer over localhost. Over a phone connection every request also pays the network delay, which the fewer, earlier requests help with but which was not measured.

## 10. Ported onto main (2026-11-26)

This work was first built on a local branch, then ported onto `main` after main moved on: the rebuilt themes and
Settings, guided farm setup, multi-pen housing, offline records and row-level security.

- **Ported:** suppliers page and picker, the feed catalogue and measures, feed recorded by bag, kg, lb or measure,
  the Feed used card, the farm briefing, dashboard section choices, and the faster dashboard totals.
- **Feed defaults** (usual bag size, how feed is counted out, feed-in-store warning days, usual breed) are now in
  Settings, Operations, next to the feed catalogue and dashboard choices. They are stored as farm preferences
  (`lib/farm-preferences.ts`).
- **Not ported, because main already covers it:**
  - Pen orientation dropdowns and the extra pen fields. Main's multi-pen housing setup replaces them.
  - The farm profile form. Main's guided `/farm-setup` holds the name, currency and location.
  - The farm "operation" setting. The briefing now judges broiler-only or layer-only from the active flocks.
- **Database:** additive SQL in `ops/postgres/`:
  - `add-health-case-lifecycle.sql`
  - `add-bird-ledger.sql`
  - `add-feed-water-eggs.sql`
  - `add-suppliers-feed-catalogue.sql`

  They replace the old `docs/migrations/2026-11-07_*` files. Apply them in that order with a verified backup, then
  re-run the farm row-security script so the new tables get the farm boundary.
