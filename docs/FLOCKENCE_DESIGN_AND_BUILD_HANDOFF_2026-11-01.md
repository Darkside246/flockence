# Flockence design, build and run handoff

**Written:** 1 November 2026, for the next AI agent (or engineer) who takes this work over.
**Repository:** `Darkside246/chicken-op` (private). **Branch:** `rebrand/flockence-2026-10-31`. **Pull request:** #7.
**Read this together with:** `docs/FLOCKENCE_REBRAND_HANDOFF_2026-10-31.md` (brand and Oriya integration, written by another agent)
and `services/blink/README.md` (camera service).

This note covers the **Cyber-Crystal redesign**, the **camera feature**, **how to run everything on the owner's Windows machine**, and
**what is still open**. Nothing here contains secrets. Secrets live in `.env`, which is gitignored.

---

## 1. What the product is

Flockence is "Intelligent Poultry Management", powered by Oriya. Tagline: *Every flock. Every decision. Connected.*
It is a Next.js 16 / React 19 / Prisma 6 / PostgreSQL app for broiler and layer farms, with a small Python camera service beside it.
The owner is a small farmer who wants it to feel like a **family poultry farm** while staying **professional**.

## 2. The design direction (what the owner asked for)

- **Cyber-Crystal:** obsidian background, translucent midnight glass, cyber-teal and ice-blue accents, diamond-white text.
- **Palette (do not drift):** background `#050A12`, `#081522`, `#0D2030`; glass `#10283A`, `#153449`; accent `#35E0D0` (teal), `#69D9F5` (ice),
  `#A2E9FF` (diamond); text `#EDF8FC`, `#A7BBC8`, `#718B9C`; status ok `#46DDB6`, warning `#FF8295`, critical `#FF526C`.
- **No gold, yellow, bronze or orange accents.** Coral/red are for status only (the hen comb in photos is fine).
- **Never show invented data.** No fake bird counts, cameras, sensors, finances or "all systems optimal". Empty states say what is missing.
  Only show a LIVE tag when a stream is really running.
- Later feedback from the owner: it felt "built by AI", so add **character, shadows and depth** (done), and it "does not look like a poultry app"
  so add **farm photography** (done with stock photos; see section 7).
- The two original reference mock-ups (a phone "AURA AI" screen and a "FLOCKENCE" phone with labelled sections) existed only in the chat.
  They are not in the repo. Ask the owner to re-attach them if you need them. The layout they implied is built: status strip, KPI row,
  2x2 camera grid, IoT/environment widgets, bottom navigation.

## 3. Running everything (Windows, PowerShell)

Working folder: `D:\Flockence\chicken-op`. The parent folder `D:\Flockence` also holds `blinkpy-src` (a reference clone of blinkpy, not part of the app)
and `devdb` (an embedded Postgres plus MediaMTX, used for earlier testing).

| Piece | How | Notes |
| --- | --- | --- |
| Database | Docker container `flockence-postgres-dev` on `127.0.0.1:54329` (database `flockence_dev`) | `DATABASE_URL` in `.env` points at it. Apply schema with `npx prisma db push`. |
| App (production) | `npm run build` then `npm run start -- -H 127.0.0.1 -p 3001` | **Preferred.** Pages answer in about 10 to 60 ms. Needs sign-in. |
| App (development) | `npm run dev -- -H 127.0.0.1` | Signs in like production (the dev auto-login was removed in the 2026-11-01 security review: it showed the cameras to anyone who could reach a dev server). Each page compiles on first visit (2 to 8 s). Run `node scripts/warm-dev.mjs http://127.0.0.1:<port>` after starting to pre-compile everything. |
| Camera service | from `services/blink`: its own `.venv`, `uvicorn app:app --host 127.0.0.1 --port 8765` | Needs `BLINK_SIDECAR_TOKEN` (same value as in `.env`) and `FFMPEG_PATH`. See section 5. |
| Preview launcher | `D:\Flockence\.claude\launch.json` (outside the repo) | Entries `flockence` (dev) and `flockence-prod` (port 3001, `autoPort: false`). |

**Ports:** 3000 belongs to a different app (a Docker container `aura-app-server`). Do not touch it. Flockence uses 3001 (production) and 3002 (dev copy).

**Environment (`.env`, gitignored):** see `.env.example`. Important ones: `DATABASE_URL`, `AUTH_SECRET` (32+ chars),
`AUTH_COOKIE_SECURE="true"` (**production refuses to sign anyone in unless this is true**; browsers still accept it on `http://localhost`),
`FARM_OWNER_SETUP_CODE`, `BLINK_SIDECAR_URL`, `BLINK_SIDECAR_TOKEN`.
There is an untracked `.env.backup-*` file in the repo root that contains secrets and is **not** covered by `.gitignore`. Add a `.env.*` rule
(keeping `.env.example`) or delete it before anyone runs `git add .`.

**Owner sign-in:** production needs a real account. From `D:\Flockence\chicken-op` run
`$env:FLOCKENCE_OWNER_EMAIL="…"; $env:FLOCKENCE_OWNER_NAME="…"; node --env-file=.env scripts/bootstrap-local-owner.mjs` (prints a one-time password).
The script only works with zero users, or exactly one user already carrying the requested email. The dev shortcut had created a passwordless
`dev@chicken-op.local` user; its email was renamed to the owner's so the script could adopt it. The owner runs this themselves so the password never enters chat.

**Quality gates (run all before pushing):** `npx tsc --noEmit`, `npm test` (25 tests), `npx prisma validate`, `npm run build`.
`tsconfig.json` excludes `services/` (HLS `.ts` segment files otherwise get parsed as TypeScript).

## 4. Where the design lives

CSS is loaded in this order in `app/layout.tsx` (order matters; later files win ties):

1. `globals.css`, `accessibility-theme.css`, `premium.css`, `premium-fixes.css`, `vision/vision.css`, `auth.css`: the older themes and shell. Do not delete.
2. **`app/crystal.css`**: tokens and base glass for `html[data-theme="crystal"]`: palette variables, cards, sidebar, controls, mobile bottom bar, camera wall,
   environment widgets, production panels, lifecycle timeline, motion, auth screens.
3. **`app/crystal-depth.css`**: layered shadows, grain, hero, KPI icon tiles, section headers, framed camera "prints", "Powered by Oriya." signature.
4. **`app/crystal-pages.css`**: turns each page's existing header into a feature banner, plus tables, forms and section furniture.
5. **`app/crystal-photos.css`**: farm photography (hero, banners, sign-in) and the primary-button colour guard.

Everything is scoped to `html[data-theme="crystal"]`, so the five older themes (Aero, Heritage, Workhorse, Sol, Terra) are untouched.
Cyber Crystal is the default (`components/theme-provider.tsx`; storage key `flockence-appearance-v3`). Theme names also appear in
`components/appearance-control.tsx` and `app/settings/page.tsx`.

**Components added for the redesign** (all under `components/`):
`dashboard-hero.tsx` (headline, greeting, quick actions, status chips), `cx-icons.tsx` (line icons), `camera-wall.tsx` (real camera pictures),
`env-widgets.tsx` (today's recorded readings), `production-panels.tsx` (broiler and layer panels), `flock-timeline.tsx` (lifecycle tracks),
`banner-photo.tsx` (chooses the banner photo by area of the app). `nav.tsx` gained the mobile bottom bar.
Page edits: `app/page.tsx` (dashboard), `app/cameras/page.tsx`, `app/settings/page.tsx` (theme list), `app/health/page.tsx` (copy).

**How page banners work:** nearly every page already renders `<header className="topbar"><div className="brand"><div>[kicker]<h1>Title</h1><p>Description</p></div>[badge]</div></header>`
then `<Nav/>`, then `<main className="main">`. The old shell hid that header. `crystal-pages.css` now shows it as the banner. **Follow this same
pattern for any new page** and it gets the banner, photo and spacing for free. Keep `<Nav/>` in the page.

## 5. Cameras

Browser calls `/api/cameras/...` (an allow-listed, role-gated proxy: `app/api/cameras/[...path]/route.ts`, client in `lib/blink-sidecar.ts`),
which forwards to the Python service in `services/blink` on loopback with a shared token. The browser never sees the token or any camera address.

- **RTSP / network cameras (mine, tested):** `services/blink/rtsp.py`. Add by name and `rtsp://` address on the Cameras page (owner only). Live view is
  ffmpeg to HLS with audio, plus snapshots, continuous recording with 7-day retention, fullscreen and save-picture. A dead camera gives up after
  8 seconds and is skipped for 30 (otherwise it stalls the dashboard).
- **Blink cameras (not mine; handle with care):** the same service can sign in to Blink through `blinkpy`. Blink's login is blocked for blinkpy
  (Cloudflare, tracked in blinkpy issue #1329). Another contributor wired a `curl_cffi` transport that impersonates an Apple Safari fingerprint
  into `services/blink/app.py` and `transport.py`, and removed my "What NOT to do about the Blink block" README section.
  **I declined to build, run or test that workaround, and the owner agreed to leave it.** Do not add browser or device impersonation, proxies, or
  login-retry loops to defeat Blink's protection. Safe directions: RTSP cameras, importing clips the owner downloads from the Blink app, and asking
  Blink for official access.
- **Import clips (built 1 Nov 2026):** the practical route for the owner's Blink footage while Blink's login is blocked. In the Blink app the owner
  downloads clips, then on **Cameras > Recordings > Import clips** picks a camera name and MP4/MOV files. Code: `services/blink/imports.py` (own module,
  wired into `rtsp.py`'s router so the Blink files are untouched), the proxy allow-list in `app/api/cameras/[...path]/route.ts`, and the `ImportClips`
  card in `app/cameras/page.tsx`. Files are stored in `services/blink/data/imports/<camera>/` (gitignored) with a small `.json` label file beside each.
  The upload is streamed (raw body, details in the query string), checked for a real `ftyp` MP4/MOV header (415 otherwise), capped by `IMPORT_MAX_MB`
  (default 500), and played back with seeking. Managers can add; only the owner can delete. Tested end to end with a 15.9 MB clip through the app.
  The page also shows Recordings and Import when **no cameras are connected** (that is exactly the Blink-blocked situation).
- **blinkpy version:** `services/blink/.venv` holds blinkpy `0.26.0b0` built from open PR #1312 (live-view token fix). `requirements.txt` still pins
  `0.25.9`. To go back: `services\blink\.venv\Scripts\python.exe -m pip install --force-reinstall blinkpy==0.25.9`.
- **Running it:** needs `BLINK_SIDECAR_TOKEN` and `FFMPEG_PATH` (ffmpeg was installed with `winget install Gyan.FFmpeg`; the path is under
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin\ffmpeg.exe`). Logs go to the console of the window that runs it.
- **Test camera:** a stale RTSP camera named "Test house" (a fake MediaMTX stream) is still configured. Remove it from the Cameras page.
  MediaMTX lives at `D:\Flockence\devdb\mediamtx` if you need a fake RTSP server again (bind it to `127.0.0.1`).

## 6. Data and schema notes

- Added to `prisma/schema.prisma` (additive): `ProductStatus.CONDEMNED`, `createdAt` on `FeedUsage` and `StorageTemperatureLog`.
  Real databases need `prisma db push` (there is no `migrations/` folder); `createdAt` on old rows becomes the push time.
- `app/api/daily-round/route.ts` used a `farmId` that `MortalityEvent` does not have; it now scopes through the flock.
- `lib/current-user.ts` auto-creates a dev owner outside production. Components also bypass login when `NODE_ENV === "development"`.
- The stored farm name in some code defaults is "Alchemy Farms". It may be the owner's real farm name; ask before changing it.

## 7. Images

All photography is in **`public/brand/`**, served at `/brand/<file>`. Credits and licence are in `public/brand/CREDITS.md`.

| File | Used for | Source |
| --- | --- | --- |
| `chick-eggs.jpg` | Dashboard hero, default banner | Pexels, Nida Kurt |
| `eggs-hands.jpg` | Banners on egg and inventory pages | Pexels, cottonbro studio |
| `hen-chicks.jpg` | Banners on flock, health, house, pens, operations and similar pages; sign-in fallback | Pexels, Andreas Ebner |
| `hen-dusk.jpg` (**not yet added**) | Optional: the owner's own brown-hen photo; hero, hen banners and sign-in use it first when present | Owner |

Pexels licence: free, no attribution required, edits allowed, **but do not use identifiable people so as to imply endorsement** (the egg photo
shows only a hand). The owner's `hen-dusk.jpg` existed only in chat, so the owner must save it as `public/brand/hen-dusk.jpg`.
To swap any photo, replace the file under the same name. Which banner photo a page gets is decided in `components/banner-photo.tsx`.
Photos are tinted and faded in CSS (`crystal-photos.css`), so use warm, uncluttered images with a clear subject.

## 8. Lessons and pitfalls (each one cost time)

- **Preview pane hidden:** screenshots go blank, animations freeze mid-state and `requestAnimationFrame` never fires when the browser pane is hidden.
  Call `tabs_select` on the tab first. A "light theme flash" or bright-green active menu item in a screenshot is usually this, or a dev stylesheet swap.
- **Lazy images plus opacity 0:** starting images at `opacity: 0` stopped `loading="lazy"` from ever loading them. Camera pictures are not lazy.
- **Hydration:** never format dates or times during render with the browser locale. Compute in `useEffect`, or fix locale and time zone (`en-GB`, `UTC`).
- **Global colour rules:** `accessibility-theme.css` forces `span`, `p`, `label` colours with `!important`; override with higher specificity.
- **Button specificity:** the raised-button rule once turned every `.button-primary` grey (31 buttons). A guard rule sits at the end of `crystal-photos.css`.
- **Fixed nav inside the banner:** some pages nest `<Nav/>` inside the header. Never put `transform`, `filter` or `backdrop-filter` on `.topbar`
  (it would trap the fixed sidebar). Pages without `<Nav/>` outside `<main>` had no navigation until this was fixed.
- **Dev mode is slow and permissive:** first visits compile for seconds, and the dev shortcut signs everyone in as owner. Never leave `next dev`
  bound to a network address. Use production mode for real use and for performance judgements.
- **Prisma `EPERM` on `prisma generate`** means a running dev server has the engine file open. Stop the server first.
- **Shell quoting:** a bash heredoc containing apostrophes (for example inside SVG data URLs) breaks the tool. Write such CSS with the file tool.
- **Upload size:** Next buffers request bodies for its proxy layer and cuts them at 10 MB. `next.config.mjs` sets
  `experimental.proxyClientMaxBodySize` to 600 MB; without it, clip uploads over 10 MB arrive truncated.
- **Testing against a stand-in service:** to exercise the app without starting the real camera service, run a tiny FastAPI app that includes only
  `rtsp.router` (it does not import `app.py` or the Blink transport) on another port, and point the dev app at it with a temporary, git-ignored
  `.env.local` (`BLINK_SIDECAR_URL`, `BLINK_SIDECAR_TOKEN`). Delete `.env.local` afterwards. Starting `next dev` by hand from `cmd` in the hidden preview pane
  produced a page reload loop; use the preview launcher entries instead.
- **`AGENTS.md`** in the repo root is written by `next dev` itself (a Next.js agent-rules block). Do not commit it by hand; consider gitignoring it.
- **Edit scripts and backslashes:** inline `node -e` or heredoc scripts can lose backslashes in regular expressions. Use the file-edit tool for those changes.
- **Git:** this machine has no git identity. Commits were made with `git -c user.name="Claude" -c user.email="noreply@anthropic.com"`. Always `git fetch`
  first; one push was rejected because the other contributor had pushed. Never force-push. Stage files by name.

## 9. How to verify your work

1. `npx tsc --noEmit`, `npm test`, `npx prisma validate`, `npm run build`.
2. Start a dev copy on its own port and run `node scripts/warm-dev.mjs`. Check every page at **390 px**, **820 px** and **1280 px**: no horizontal scroll,
   banner visible, bottom bar (phones) or sidebar present, readable text. A contrast and overflow audit was run across all 24 pages and passed
   (the design-system page flags samples on purpose; it is a theme stress-test).
3. Check the sign-in screens in **production** only (dev redirects them away).
4. Check empty states with the real (empty) dev database, then with real data. Panels, the lifecycle timeline and environment readings have only been
   seen empty, and the timeline once with temporary sample rows that were deleted.

## 10. Commit and push practice agreed with the owner

Commit and push only when the owner says so. Summarise what is in the commit, scan the staged diff for secrets, push without force, then
re-fetch and confirm local and remote match. Files deliberately **not** committed: `next-env.d.ts` (Next rewrites it), `package-lock.json`,
`tsconfig.tsbuildinfo`, `.env.backup-*`, and `services/blink/test_*.py` (another contributor's Blink connection experiments).

## 11. Open work, in rough priority

1. Owner saves `public/brand/hen-dusk.jpg`; verify hero, hen banners and sign-in; commit it.
2. Owner restarts the camera service (it still runs old code without the dead-camera fix); remove the "Test house" camera.
3. Add `.env.*` to `.gitignore` (keep `.env.example`).
4. Real data pass: add a real flock and daily checks, then review the production panels, lifecycle timeline, environment widgets and charts with numbers in them.
5. Visual polish pass on forms and tables with real records (the empty states are well covered; dense data is not).
6. Tablet-width check of the camera wall and banners; sign-in and sign-up on a phone.
7. Wire real environment sensors and smart devices if they are ever added (the dashboard says "Not connected" today, truthfully).
8. Blink: wait for an official fix or access (blinkpy#1329, PRs #1310 and #1312); until then use RTSP cameras or the built **Import clips** feature. A nicer follow-up: generate poster thumbnails for imported clips with ffmpeg (they show a plain dark tile today).
9. Real-world deployment: HTTPS, a real `APP_URL`, and the secrets and database plan in `docs/PRODUCTION_DATABASE_MIGRATION_BASELINE.md` and `docs/BACKUP_AND_RECOVERY.md`.

## 12. Do not

- Do not invent data, devices or statuses to make a screen look fuller.
- Do not add colours outside the palette, and no gold or yellow.
- Do not evade Blink's login protection or impersonate devices.
- Do not push, force-push, delete data or install software without the owner's approval.
- Do not put camera addresses, tokens or passwords in frontend code or in commits.
