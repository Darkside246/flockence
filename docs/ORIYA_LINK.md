# Flockence and Oriya: Oriya is the brain

Owner's decision (2026-11-01): **Flockence collects the farm data and the Blink pictures; Oriya processes them into
structured findings and alerts and sends them back.** People see and use everything in Flockence. On Oriya this is
developer-only. Blink is the only camera source (no RTSP). Both apps run on DigitalOcean droplets
(Flockence at `flockence.oriya.si`); nothing on a farm or a home PC is opened to the internet.

Oriya's side and its exact formats: Oriya repo, `docs/notes/FLOCKENCE_ORIYA_BRAIN_API_2026-11-01.md`.

## What was added here

| File | What it does |
| --- | --- |
| `lib/oriya-link.mjs` (+ `.d.mts`) | Pure, tested: signing and checking (`v1` HMAC-SHA256 over `v1:<timestamp>:<raw body>`), link settings, allowed cameras, strict request reading, picture checks by real bytes, the `FLOCK_CHECK` builder, death reason to fixed cause. |
| `lib/oriya.ts` | Pictures from the Blink sidecar's existing `/cameras/{name}/snapshot`, one-use request ids, today's farm numbers, the signed send to Oriya, Oriya's alerts kept as health observations (`ORIYA:<kind>`). |
| `app/api/integrations/oriya/camera-frames/route.ts` | Oriya asks for pictures from one camera ("check camera 1 now"). |
| `app/api/integrations/oriya/push/route.ts` | The scheduled run: numbers, then pictures. |
| `scripts/oriya-push.mjs` | What cron runs; calls the push route on this machine. |
| `tests/oriya-link.test.mjs` | 7 tests (signing, window, settings, cameras, request reading, picture checks, flock check). |

## Signing (both directions)

```
X-Oriya-Key:        cop_...            (Flockence -> Oriya only)
X-Oriya-Timestamp:  Unix seconds       (within 5 minutes)
X-Oriya-Signature:  v1=<hex HMAC-SHA256(ORIYA_LINK_SECRET, "v1:<timestamp>:<exact raw body>")>
```

Checked against Oriya's own code: the same body and secret give the same signature, and Oriya's strict schemas accept
the `FLOCK_CHECK` and `FLOCK_SNAPSHOT` Flockence builds.

## Flockence -> Oriya (scheduled)

`scripts/oriya-push.mjs` calls `POST /api/integrations/oriya/push` (Bearer `ORIYA_PUSH_TOKEN`), which:

1. sends today's numbers to `POST {ORIYA_URL}/api/public/farm/chicken-op/flock-checks`: deaths in the last 24 hours
   with fixed causes (the free-text reason never leaves), feed on hand and used in 24 hours, live birds, age of the
   oldest active batch, open health cases;
2. with `thumbnail`, sends each allowed camera's latest Blink thumbnail; with `fresh`, takes up to 3 new pictures
   3 seconds apart (wakes the camera, uses battery) - to `.../flock-snapshots`;
3. keeps Oriya's alerts as health observations (category `ORIYA:<kind>`, urgent ones as URGENT), so they show on the
   Health pages.

Suggested cron on the Flockence droplet:

```
*/10 * * * *  cd /opt/flockence && node scripts/oriya-push.mjs thumbnail
7 * * * *     cd /opt/flockence && node scripts/oriya-push.mjs fresh
```

## Thermometers, the earlier picture and the automatic schedule (2026-11-02)

- **Thermometers.** Readings are kept in `ThermometerReading` (the farm's own name per thermometer, time, °C,
  humidity). Import a thermometer app's CSV export (SwitchBot-style; °C or °F; times read as `FARM_UTC_OFFSET`):

  ```
  node --env-file=.env scripts/thermometer-import.mjs "D:\path\Smart Thermometer 1_export_202611010054.csv" "Thermo 1"
  ```

  Running it twice adds nothing twice. Each check sends every thermometer's latest reading from the last 3 hours
  (and the one about an hour before it) as `climate`; older history is never sent. Oriya works out the heat index,
  dew point gap, heating rate and quiet thermometers and answers with alerts and `nextCheckMinutes`.
- **Live thermometers.** SwitchBot (with a SwitchBot Hub): put `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET` from the
  SwitchBot app in `.env`, run `node scripts/switchbot-devices.mjs` to list the thermometer ids, and set
  `SWITCHBOT_THERMOMETERS="Thermo 1=<id>,Floor 2=<id>"`. Before each check (at most every 5 minutes) Flockence reads
  them from SwitchBot's cloud. Any other thermometer bridge can post to `/api/integrations/thermometers/readings` with
  `THERMOMETER_PUSH_TOKEN` (strict body, at most 500 readings, 30 requests a minute).
- **Earlier picture.** After each Live View, the camera's last picture is kept in `storage/oriya-frames/`, encrypted
  (AES-256-GCM, key derived from `AUTH_SECRET`, file named by a hash of the camera code, 0600). The next Live View
  5 to 120 minutes later sends it as `reference`, so Oriya can see which lying birds have not moved. Thumbnails are
  never used for this (they can be hours old).
- **Farm clock.** Times sent to Oriya carry the farm's offset (`FARM_UTC_OFFSET`, default `-04:00`), so Oriya knows
  when it is dawn or the midday heat.
- **Automatic schedule.** `node scripts/oriya-watch.mjs` (or cron `* * * * * node scripts/oriya-push.mjs auto`):
  numbers and thermometers every 10 minutes; Live View at dawn (05:00-07:00) every 15 minutes, 11:00-17:00 every
  30, otherwise hourly; sooner when Oriya's answer asks; never more than `ORIYA_DAILY_LIVE_VIEWS` (default 40) a day.

## Oriya -> Flockence ("check camera 1 now")

`POST https://flockence.oriya.si/api/integrations/oriya/camera-frames`, signed by Oriya:
`{ "requestId": "oriya-<uuid>", "camera": "Coop 1", "frames": 3, "secondsApart": 3 }`.
Flockence checks the signature and window, accepts each `requestId` once (kept in Settings), allows only cameras in
`ORIYA_CAMERAS`, at most 10 requests a minute, takes fresh pictures through the sidecar, checks each by its bytes
(JPEG/PNG/WebP, at most 1.5 MB) and replies `{ occurredAt, kind: "LIVE_VIEW", frames: [...] }`.

## Settings (server `.env` only)

| Name | Meaning |
| --- | --- |
| `ORIYA_URL` | Oriya's address, `https://oriya.si` (HTTPS on oriya.si or an address under it) (`ORIYA_ALLOWED_HOST` to change the domain). |
| `ORIYA_LINK_KEY_ID`, `ORIYA_LINK_SECRET` | From Oriya: Farm settings > Chicken Op link. Never paste them in chat. |
| `ORIYA_CAMERAS` | `code=Blink camera name, ...`; Oriya sees the code only. |
| `ORIYA_HOUSE` | House name sent with each check. |
| `ORIYA_PUSH_TOKEN` | Long random token for the scheduled push (24+ characters). |
| `FLOCKENCE_LOCAL_URL` | This app on this machine, e.g. `http://127.0.0.1:3000`. |

On Oriya's server: `CHICKEN_OP_LINK=on`, `FLOCKENCE_URL=https://flockence.oriya.si`, and an OpenRouter vision model.

## Safety

- No camera addresses, Blink tokens, names, phone numbers or free-text notes go to Oriya; strict fields only.
- The Blink sidecar stays on loopback with `BLINK_SIDECAR_TOKEN`; the Blink login, MFA and Live View fixes are untouched.
- Pictures are sent for analysis and are not stored by Oriya; Oriya's model is told only to say whether a person is in
  frame, never to describe them.
- Keep the Blink fixes when upgrading BlinkPy (curl_cffi iOS Safari fingerprint, real `liveview_token`, the 9-byte
  `0x0C` message, 188-byte MPEG-TS framing). The NordVPN DNS settings belong to the owner's PC; leave them off on the droplet.

## Tested live with Oriya (2026-11-01)

Both apps ran together over HTTPS at their real names (`oriya.si`, `flockence.oriya.si`, test certificate): this app
(`next dev`) on its own Postgres with real farm records, and Oriya's real farm link routes and services. Only the Blink
cameras (a stand-in sidecar on 127.0.0.1:8765 returning a real JPEG) and Oriya's vision model were stand-ins.

- `node scripts/oriya-push.mjs fresh` sent the numbers (6 heat deaths, 50 kg feed left) and 3 fresh pictures from each
  of two cameras; Oriya returned DEATH_SPIKE, FEED_RUNNING_OUT and DEAD_BIRD; all four were saved as health observations.
- Oriya's "check camera now" fetched 3 fresh pictures from "Coop 1" and got DEAD_BIRD back.
- Refused live: replayed request (409), wrong signature and 10-minute-old timestamp (401), unlisted camera (404), extra
  field such as a camera address (400), push without or with a wrong token (401).
- Fixed by the live run: a syntax error in `scripts/oriya-push.mjs`.

## Still to do on the real servers

- Run against the real Blink sidecar and cameras on the Flockence droplet, and the real Oriya at `https://oriya.si`
  with its vision model set.
- A Flockence screen for Oriya's alerts beyond the existing Health pages.
