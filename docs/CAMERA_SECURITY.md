# Camera and video security (review and pressure test, 2026-11-01)

Owner's aim: **no one outside the farm can see the camera feed, and everything between Flockence, the Blink camera
service and Oriya is hardened, without losing connection or access.** This records what was found, what changed, how it
was tested, and what still depends on the servers.

## Who can see the video now

| Path | Who | How it is enforced |
| --- | --- | --- |
| Browser -> `/api/cameras/*` (pictures, live video, clips) | Signed-in farm members in `CAMERA_VIEW_ROLES` (default owner, manager, worker; read-only users cannot) | Session cookie checked in middleware (cheap refusal) and again in the route; per-person allowance per minute |
| Starting/stopping live view, importing clips | Owner and manager; deleting clips and the Blink login: owner only | Route role checks; every live start/stop and clip import/delete is in the audit log |
| App -> camera service (`services/blink`, port 8765) | This machine only, with `BLINK_SIDECAR_TOKEN` | The service refuses any other address (403) even if started on `0.0.0.0`; token compared in constant time |
| Oriya -> `/api/integrations/oriya/camera-frames` | Oriya, signed with the farm's link secret | v1 HMAC over the exact body, 5-minute window, each request once, listed cameras only, 10 a minute |
| Flockence -> Oriya (scheduled push) | Cron on this server with `ORIYA_PUSH_TOKEN` | Bearer token, 30 a minute |

## What was wrong and is fixed

1. **Anyone could watch the cameras on a development server.** When the app was not in production mode it signed every
   request in as the owner, and an `x-user-id` header could pick any user. A dev server reachable on a network (or a
   production server started without `NODE_ENV=production`) showed the feed to anyone. **Removed**: no sign-in means
   no access, in every mode. (A "this machine only" check was tried first and dropped: the caller controls the Host header.)
2. **The camera service answered anyone who reached it with the token**, compared the token in a way that can leak it
   through timing, and published its API description page. Now: this machine only (or `BLINK_SIDECAR_ALLOWED_CLIENTS`),
   constant-time comparison, no docs page, a warning for tokens under 32 characters.
3. **The Blink login was stored in plain text** (`services/blink/data/credentials.json`). With `BLINK_CREDENTIALS_KEY`
   it is now AES-256-GCM encrypted; an old plain file is read once and rewritten encrypted, so no new Blink login is needed.
4. **Recordings, live segments and clips were created with default permissions.** The service now creates every file
   readable by its own user only.
5. **Camera responses could be cached or embedded elsewhere.** They are now `no-store, private`, same-origin only
   (`Cross-Origin-Resource-Policy`), `no-referrer`, `nosniff`, sandboxed, and not indexed.
6. **Read-only accounts could watch the cameras.** Now only `CAMERA_VIEW_ROLES` (default owner, manager, worker).
7. **Every request, even forged ones, wrote to the database first** (`ensureFarm`), so a flood loaded the database for
   free. Now once per server start; requests with no session or no signature are refused before any page code runs.

## Tests

- **Unit**: 32 Node tests (Oriya link and poultry metrics), 21 Python tests for the camera service (5 new: token,
  this-machine-only, encrypted login incl. tampering and wrong key, private files), whole-project type check, production build.
- **Real camera service** started on `0.0.0.0`: this machine with the token 200, wrong token 401, **another address
  with the right token 403**, docs page 404. Flood of 3,000 wrong-token requests (150 at a time) while the app made 300
  real requests: all 3,000 refused, all 300 served (p50 117 ms, max 300 ms).
- **Whole app, production build**, four signed-in roles, stand-in camera service serving a live playlist and 200 KB segments:
  - Access: no sign-in, `x-user-id`, forged cookie, live segment without sign-in: 401. Read-only: 403. Worker,
    manager, owner: 200. Worker starting live view: 403. Manager: 200. Paths outside the allow-list: 404. Headers as above.
  - Pressure: 3 people watching live video (a playlist and a segment every second, 30 s) while attackers sent 4,000
    unsigned, 2,000 forged-cookie and 1,000 forged-Oriya requests (up to 300 at a time). **Every attack refused; every
    viewer request served (158 of 158).** Typical 23-26 ms; during the heaviest burst a few took up to 3.2 s (6.3 s before
    the front-door refusal). With no attack: p50 21 ms, max 63 ms. Test machine: 4 processors shared by app, database and
    the attack generator.
  - One person sending 700 camera requests in a minute is cut off at the allowance (429) while the owner keeps watching.

## What still depends on the servers (do these)

1. **Cloudflare in front of `flockence.oriya.si`**: add a rate-limiting rule for `/api/cameras/*` and
   `/api/integrations/oriya/*` (for example 300 requests per 10 seconds per IP). A flood big enough to fill a small droplet's
   processors must be stopped before it reaches it; the app cannot do that itself.
2. **Strongly recommended: Cloudflare Access** (Zero Trust, free for small teams) on `flockence.oriya.si`, allowing only your
   own email addresses, with a bypass (service token) for `/api/integrations/oriya/*`. Then nobody even reaches the sign-in page.
3. **Set `BLINK_CREDENTIALS_KEY`** on the Flockence server (keep a copy in your password manager; without it the saved
   Blink login cannot be read and you log in to Blink again).
4. **Keep the camera service on 127.0.0.1** (`uvicorn app:app --host 127.0.0.1 --port 8765`) and use a long random
   `BLINK_SIDECAR_TOKEN` (32+ characters).
5. **Recordings at rest**: put `BLINK_DATA_DIR` on an encrypted disk (DigitalOcean volumes are encrypted at rest; on a
   Windows PC use BitLocker on D:). Files are already private to the service's user.
6. **Run production mode** (`npm run build` then `npm run start`), never `npm run dev`, wherever the app is reachable.

## Things you should know

- **Cloudflare can see traffic it proxies.** With the orange cloud on, Cloudflare decrypts and re-encrypts traffic, so
  in principle it can see the video passing through. It does not store it (`no-store`). If that is not acceptable, the
  alternative is a direct connection without the orange cloud, losing Cloudflare's flood protection.
- **Pictures sent to Oriya are looked at by an AI model** through OpenRouter. Oriya asks OpenRouter to use only
  providers that do not keep or train on the data (`data_collection: deny`, Oriya's default). Oriya itself never stores
  the pictures. To keep pictures entirely off third-party services, don't list cameras in `ORIYA_CAMERAS`; the farm
  numbers still go to Oriya.
- Blink's own cloud stores clips and thumbnails as Blink does for every customer; Flockence cannot change that.
