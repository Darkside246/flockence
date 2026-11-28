# Farm camera and database isolation

## Camera workers

The signed-in farm and role select a worker. The default-farm worker still uses the existing BLINK_SIDECAR settings. A different farm gets no worker until an operator installs a separate worker for it. Only farm owners can set up or disconnect a provider account. The Blink form uses the existing unofficial Blink client and supports its verification-code challenge. Wyze cloud and other vendor account logins need separate, supported integrations.

Each customer worker needs a separate non-login Unix account, private state directory, separate random token and encryption key, and a unique loopback port. Run it with BLINK_REQUIRE_ENCRYPTION=1 and an owner-only key file. Keep FFmpeg, recordings, pending Blink challenges and provider sessions in that worker's boundary. Restrict egress to the provider and keep customer workers away from internal databases and other farms' endpoints. The app disallows customer RTSP setup until a private farm gateway is available. The existing one-time installer is for the default farm. The template at ops/systemd/flockence-camera@.service defines a separate dynamic Unix user and a private StateDirectory per port. Install the sidecar code and venv under the root-managed, non-writable /opt/flockence-camera-runtime tree and keep the instance's token and key in a root-only /etc/flockence/camera-workers/<port>.env. A farm using the template must pass the authenticated status check and an owner sign-in before it is added to the app manifest. The template blocks writable shared server paths and disables network camera registration inside the worker too.

After provisioning, a root-managed systemd EnvironmentFile for the app can set FLOCKENCE_CAMERA_WORKERS to a JSON object keyed by farm ID. Each value contains url (http://127.0.0.1 plus its unique port) and token. The token must match that worker. The app rejects an invalid or duplicate endpoint/token and never uses the default farm's worker for a different farm.

The worker encrypts saved Blink sessions and RTSP addresses when BLINK_CREDENTIALS_KEY is set. Preserve the key in the secret backup before enabling encryption on an existing worker. The provider password and MFA code are transient and remain outside the database.

Oriya still uses the install's default camera allowlist. Per-customer Oriya video sharing requires explicit farm-scoped camera permissions first.

## PostgreSQL staging baseline

The policy file is exercised by CI with an unprivileged role and direct SQL. It covers farm-owned rows and child records that inherit their farm through a parent. The app's existing cross-farm link validation still applies.

Live rollout requires a restricted, non-owner request role and a transaction-local app.farm_id on every tenant query, including existing transactions and background jobs. The application must derive the ID from verified identity. Bootstrap, authentication and migrations need separately scoped database access. A role able to issue arbitrary SQL can change its own transaction settings, so database credentials and raw-query paths remain server-only. The policy file alone does not wire Prisma into that role and scope. Apply it only to a disposable database or staging environment until that wiring, a restored-backup rehearsal and a sign-in/signup test pass.

## Adding a camera worker for another farm (one command)

`ops/cameras/add-farm-camera-worker.sh` does the per-farm set-up above. On the VPS, after the home camera service is
installed (`services/blink/install-vps.sh`):

```bash
sudo bash /opt/flockence-release-<short>/app/ops/cameras/add-farm-camera-worker.sh <farm-id>
sudo bash /opt/flockence-release-<short>/app/ops/cameras/add-farm-camera-worker.sh --list
```

It checks the farm exists and is not the home farm, then creates a non-login account `fcam-<hash>`, a private state
directory, a random token and Blink encryption key (`BLINK_REQUIRE_ENCRYPTION=1`) in `/etc/flockence/camera-<hash>.env`,
and `flockence-cam-<hash>.service` on the next free port from 8766. It reuses the installed camera code read-only. It
checks the worker answers, adds it to `/etc/flockence/camera-workers.env` (`FLOCKENCE_CAMERA_WORKERS`, read by the app
through a systemd drop-in) and restarts Flockence. Any failure removes what it made for that farm and leaves the app as
it was. The farm's owner then connects their cameras under Cameras.

When a farm is deleted (Settings > Farm profile), stop and remove its worker by hand: `systemctl disable --now
flockence-cam-<hash>.service`, remove its unit, env file and state directory, delete its entry from
`camera-workers.env`, and restart Flockence.

