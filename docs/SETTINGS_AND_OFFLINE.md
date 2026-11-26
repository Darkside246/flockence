# Settings, access and offline release

## Audit and boundaries

The current app uses farm Owner, Manager, Worker and Read-only roles, an
explicit allowlist for ordinary preferences, existing team and account pages,
and signed Oriya linking. The older PWA cached application pages and had no
durable write queue. The dashboard and mobile browser layout already exist.
The production schema still needs its reviewed migration baseline.

| Area | Design in this release |
| --- | --- |
| Account and team | Existing account and session tools. Owners manage membership. Settings link to those tools. |
| Farm preferences | Owners and managers can edit. Existing roles can read. The server saves only the allowed fields in a transaction and rejects a stale form. |
| Platform | Separate, read-only diagnostics. Access requires an exact application user ID in server-only `FLOCKENCE_PLATFORM_ADMIN_IDS`. Farm roles and plans grant no platform access. Global configuration changes still use the VPS and Oriya administration. |
| Free | Farm operations, basic reports and offline mortality and live-weight recording use existing server roles without a premium check. |
| Premium | Camera routes, gateway and video evidence access, new AI vision inspections and thermometer intake use a shared server gate. Free members cannot call those APIs directly. Farm exports and past inspection records remain available according to farm roles. |
| Linked plan | Oriya’s signed entitlement check is the source of truth. It verifies the ready farm link in the business scope. Results are cached per link in server memory for up to 30 seconds. No provider secrets or billing records reach the browser. |

## Rollout

Deploy Oriya’s signed entitlement endpoint before enabling
`FLOCKENCE_ENFORCE_PREMIUM=on` in hosted Flockence. With rollout off,
explicit Free memberships are still denied premium actions. Existing
deployments without a Free marker keep their prior feature access during
staging. When enforcement is on, unlinked farms start free by default.
`FLOCKENCE_STANDALONE_PREMIUM=on` permits a dedicated, unlinked default
farm to use premium features without Oriya. Keep this server setting off
for hosted customer use. Existing Oriya SSO and provisioning still require
their current Oriya entitlements. New public self-service farm signup is
separate work.

All browser plan responses carry only a status and, for a connected farm,
the existing Oriya base address. The platform diagnostics page reads no
user-defined secret value. Rollout variables belong in the VPS environment.
This slice introduces no new Prisma schema changes. Its base still contains
the assessment migration from PR #13 and must follow that release's staging
procedure.

## Offline mortality and live weights

Open Storage & Sync online to prepare the browser using a strong, separate
device passphrase. The service worker caches a generic public HTML shell and
its scripts and styles. Private application routes and APIs stay on the network.
The old broad page cache is removed when the replacement worker activates.

IndexedDB stores one workspace per browser and its append-only outbox.
AES-GCM protects the content using a key derived from the device passphrase.
The workspace locks when hidden. Offline unlock expires after seven days
without verifying the original account online. The encrypted backup remains
available when locked and retains unsynchronised material. Clearing browser
storage may remove locally held data. An automated import and recovery UI
is not part of this slice.

The outbox stores each entry before showing “Saved on this device.” It
sends only while it has the original authenticated farm account, checks
the server receipt before dropping an entry and retries temporary failures.
The server binds a stable mutation ID to the authenticated user and farm
and serializes concurrent retries in PostgreSQL. A retry returns the
existing event. A changed payload using the same ID or a failed flock
reconciliation is left for review. Ordinary online mortality keeps the
same validation and bird-count calculation.

## Device and next-operation acceptance checks

Run full-browser offline reload, sync and retry tests against staging.
Repeat on actual Android and iOS after preparing the device. Verify
foreground sync, rebuilding after restart, revoked sessions, reassignment
and browser storage limits. The staging workflow must use disposable
accounts and a protected restoration of production schema when rehearsing
deployment.

Live weights sync as sample measurements. A retried event is idempotent, and an existing measurement for the same flock, date and type remains in place for human review. Extend the outbox to independent feed, egg and inspection events next.
Add controlled reconciliation before queuing shared inventory or financial
updates. Add attachments, secure recovery/import and additional farm context
after testing quotas and shared devices. Keep the same authenticated
idempotent endpoints when adding a native adapter. Browser and native
background work is best effort. Capacitor packaging, native SQLite,
device tests and store signing are separate stages. [Next.js PWA guidance](https://nextjs.org/docs/app/guides/progressive-web-apps)
