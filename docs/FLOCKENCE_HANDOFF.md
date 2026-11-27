# Flockence engineering handoff

_Last checked November 26, 2026._

This handoff records the production release, what was verified, and where to resume. Use GitHub for source and the Spaceship VPS for deployment and staging. Production is [flockence.com](https://flockence.com). The Flockence repository is `Darkside246/flockence` and the deployment source is `main`. Keep work in Flockence. Changes to the Oriya repository, its deployment, and its Operator configuration are outside the current instructions. Use its existing contracts for compatibility checks.

## Production state

- **Live application revision** `33322ad1c8548d9ec5f4cca2788a13c926125b94`. The prior live release was `5f8dac0`.
- **Deployment evidence** The operator reported `ALTER TABLE` and `COMMIT`, then HTTP 200 from `/login` after one transient HTTP 502 during the restart. The script checked the running service process's working directory before printing the live revision.
- **Database rehearsal** A copy of the active local PostgreSQL database was restored into a temporary database. The supplied SQL added `public."HealthObservation"."visionAssessment"` and the check returned `jsonb:YES`. The temporary database was dropped afterward. This rehearsal validated the additive column. Full isolation rehearsal with the actual VPS authentication, restricted roles, and production-shaped data is still pending.
- **Backup** The deploy created a root-private custom PostgreSQL archive under `/var/backups/flockence-before-33322ad.*` and verified its table of contents. Store backup locations, keys, and access information in the VPS operations records.
- **Access** The shell available to the agent reached the VPS SSH service but was rejected with `Permission denied (publickey)`. The operator executed the rehearsal and switch from their VPS session. Regain authorized SSH access before attempting direct changes.
- **Prepared versus running** GitHub `main` may advance ahead of the deployed application. On the VPS, check the `flockence.service` working directory, live process, Git revision, and HTTPS response before reporting a deployment complete. Future systemd drop-ins must take precedence over existing release overrides.
- **Credentials and services** Resend, reCAPTCHA, Blink, and Oriya configuration on production were not confirmed end to end. The repository contains the startup helper for local PostgreSQL and the camera worker. Current VPS helper activation, camera worker revision and reboot recovery still need checking. The migration and app switch did not apply the optional PostgreSQL role-policy scripts.

## Work merged and checked

| Area | Available in the deployed app release | Remaining verification or work |
| --- | --- | --- |
| Release and onboarding | Guided farm setup, flock creation with initial counts and pen selection, and separated Free signup and invited/owner setup. Includes the PostgreSQL advisory lock fix, pinned dependencies and lockfile. | Verify public rollout using the configured sender, CAPTCHA and real email delivery. |
| Signup and email | Public Free signup issues an inbox confirmation link that expires after 30 minutes, and consumes it once when creating an isolated farm. Optional welcome email and password-reset email use Resend. | No recorded production challenge or email-delivery test. Existing invitation-code registration does not bind an invite to a mailbox. |
| Account abuse controls | Server-verified reCAPTCHA for public Free signup and, when configured, local sign-in, invited/owner setup, and password-reset requests. Same-origin JSON and size checks on account forms, per-network and account quotas, and team-change limits. Password reset completion uses its expiring recovery token and no-referrer policy. | Verify production settings and the trusted proxy's `X-Real-IP` header, then test challenge rejection, real login and email delivery. |
| Settings, themes and search | Grouped farm, account, plan and integration settings, existing themes and photography, compact pinned desktop search, and direct mobile Search. Platform status is restricted separately from ordinary farm roles. | Complete account/contact preferences, notifications, privacy controls, billing lifecycle, per-pen permissions, and field accessibility checks. |
| Team management | Owners and managers can create expiring, single-use codes and manage allowed farm roles. Manager restrictions, audit logging and last-owner protection are in place. | Email invitation links, a simple invite acceptance flow, and a reviewed Farm Hand/Supervisor permission matrix. Start here. |
| Cameras | Provider selector, Blink login/MFA through a private worker, official Wyze sign-in link, and private farm gateway snapshots. Farm Vision records camera snapshots and applies saved, audited camera-to-pen assignments for connected Blink and network-worker cameras. | A supported Wyze account-link and discovery flow, real hardware acceptance, and camera assignment support for gateway feeds where needed. Rename-safe Blink identity requires a worker version that emits the camera fingerprint. |
| Poultry vision | Permission-controlled private evidence, structured observations, historical snapshot comparisons, and bounded signed frame inputs. ChickenVerse benchmark tools are for research. | Continuous live inference, validated individual bird tracking and counts, heatmaps, behavior models, calibrated scoring, and real-farm model evaluation. Check dataset licensing before any commercial use. |
| Storage and devices | Farm-scoped export, private Blink archiving, supported sensor intake, and Flockence-side signed pen reports and temperature sharing. CI exercised restricted PostgreSQL runtime roles. | Production role rehearsal and activation, real sensor and camera operation, storage retention, wider export/restore acceptance, and live Oriya verification. |
| Offline and mobile | Encrypted browser outbox for mortality, live sample weights, daily egg collections and feed consumption. Reload and reconnect, idempotent writes and conflict retention are covered in CI. | Expenses, sales, vaccinations/treatments, full inspections, attachments and recovery import. Native Android/iOS packaging, SQLite, signing, and actual device testing remain open. |

### Release evidence

- [PR #19](https://github.com/Darkside246/flockence/pull/19) and [CI](https://github.com/Darkside246/flockence/actions/runs/45887367663) cover the consolidated launch work, onboarding, verified Free signup, and reCAPTCHA for signup.
- [PR #20](https://github.com/Darkside246/flockence/pull/20) and [CI](https://github.com/Darkside246/flockence/actions/runs/45888600869) cover account-form hardening.
- [PR #21](https://github.com/Darkside246/flockence/pull/21) and [CI](https://github.com/Darkside246/flockence/actions/runs/45895653337) cover camera assignment, mobile search, expanded offline records, and the restricted-role checks.
- [Full requirements audit](RELEASE_REQUIREMENTS_AUDIT.md) maps both development briefs to implemented, partial, and open items. The boundaries below guide implementation and release.

## Next implementation for emailed team invitations and role limits

The user wants the farm administrator to select a role and enter an email. The recipient should click a single-use link, see which farm they are joining, enter their name and create their password. The farm and role are assigned by the invitation. Prioritize this before expanding cameras or mobile packaging.

### Existing code and compatibility

- [Team screen](../app/team/page.tsx) and [Team API](../app/api/team/route.ts) handle the directory, invitation creation and role changes. Invitations are presently stored as farm-scoped settings with a token digest, role, expiration and actor. The current API shows a manual code once. It does not send an invitation email.
- [Local signup](../app/api/auth/signup/route.ts) redeems current codes in the default-farm flow. An emailed invitation must resolve the authoritative target farm without trusting a farm ID supplied by the browser. Make the invited flow safe for non-default farms. Preserve active manual invitations and initial owner setup during rollout.
- [Free signup](../app/api/auth/free-signup/route.ts), [email proof](../lib/free-email-proof.ts), [mail](../lib/mail.ts), and [account form security](../lib/account-form-security.ts) provide existing patterns for possession of an inbox, delivery, throttle and origin checks. Keep joining a team distinct from creating a Free farm.
- [Farm access](../lib/current-user.ts), [Prisma schema](../prisma/schema.prisma) and [tenant scoping](../lib/farm-scope.ts) matter when resolving user identity. A user row currently has one farm and email is globally unique. Handle an email already in the system safely. Do not transfer an existing user, overwrite their password, or promise multi-farm membership without an explicit membership design.
- Keep the stored role values initially. Proposed labels are **Farm Hand** for `WORKER`, **Supervisor** for `MANAGER`, **Read Only** for `READ_ONLY`, and **Owner** for `OWNER`. These labels describe the intended rollout, not a completed review of every endpoint.

### Requirements for the next change

1. Tie the invitation to the normalized recipient address, target farm, assigned role, inviter and expiry. Store a digest of an unpredictable token. Keep the raw token out of analytics, request logs and email click tracking.
2. Make opening the link safe for email security scanners. Only the explicit registration submission consumes the invite. Reuse the existing CAPTCHA, origin and rate-limit controls for public form submissions. Keep the recipient's address and role out of editable registration inputs.
3. Create the user, record credentials and consume the invitation atomically. Simultaneous redemption must produce at most one membership. Handle expiry, revocation, replay, delivery failures, and safe reissue. Keep errors for invalid public links generic.
4. Audit actual API coverage. Farm Hands need everyday logs within their farm. Supervisors manage farm operations and the lower roles they are authorized to manage. Read Only must reject writes, and access to sensitive data and exports requires explicit policy. Owners control privileged roles and sensitive settings. Preserve the last Owner requirement. Feature entitlements remain separate from farm roles.
5. Test delivery failures, email and farm binding, expiry, replay, concurrent attempts, unauthorized role changes, ordinary Free signup, existing code redemption, and isolation with the dedicated PostgreSQL tenant role. Test mail against a staging inbox and run the browser registration flow before enabling production delivery.

## Other open work and dependencies

- **Production RLS and rollout** Follow [Farm storage and isolation](FARM_STORAGE_AND_ISOLATION.md). Use an authorized restored database to verify login, ordinary writes, exports and cross-farm rejection with the actual runtime roles. An additive schema rehearsal is different from a role-policy rehearsal. Keep PostgreSQL credentials and backup material private.
- **Resend and CAPTCHA** Follow [Signup email setup](SIGNUP_EMAIL.md). The active release environment needs the correct domain-restricted sender key and reCAPTCHA v2 keys for the actual hostname. Test password sign-in and password reset before opening public signup. Verify the real email link with click tracking disabled. Keep the operator's existing session during checks.
- **Camera readiness** Check the service startup and runtime configuration using [VPS startup](VPS_STARTUP_AND_EMAIL.md), [Camera Vision](CAMERA_VISION.md), and [gateway requirements](CAMERA_GATEWAY.md). Wyze Web View is a vendor login link. It does not import cameras into Flockence. A discovery implementation needs a supported integration, secure farm-scoped token handling and real-device verification.
- **Offline and native apps** Extend the current [offline architecture](SETTINGS_AND_OFFLINE.md) one record type at a time. Preserve encrypted drafts, original-account binding, duplicate prevention, and conflict review. Financial and inventory records need reconciliation rules. Keep a separate native test and distribution track using real Android/iOS devices.
- **Vision and Oriya** Review the [poultry intelligence research](POULTRY_INTELLIGENCE.md) before adding a licensed detector or live tracking. Validate across farm conditions before presenting results as operational signals. For [Oriya Operator](ORIYA_OPERATOR_PENS.md), use an already-authorized premium staging business and linked farm to verify pen lookup, updates, real reminder delivery and downgrade/cross-farm rejection. The Flockence HTTP tests are contract checks, not a WhatsApp end-to-end test.

## Completion criteria for future handoffs

Record the exact GitHub commit, the exact live app revision, CI links and the scope of any stage or production test. List the user-facing behavior separately from provider or VPS configuration still required. Report temporary failures and the recovery outcome. Update this handoff when deployments or priorities change.
