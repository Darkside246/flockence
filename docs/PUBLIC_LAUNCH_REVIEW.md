# Public launch review

## Verified starting points

- Flockence main was at e6788fbb. This branch starts at 4932182e, the tip of the VPS-hardening draft with passing CI and the signup fix verified on the trial VPS. Review and UX branches contain separate, unmerged changes. Review and bring forward relevant changes individually.
- Oriya main was at a8c8512c. The integration consolidation branch at 4b2c3c0e was 2 commits behind and 2,364 ahead of main. It carries the Flockence SSO router, account service, commercial entitlement migration 1587 and the companion tests. Its presence in GitHub does not establish the code running at oriya.si.
- Oriya's integration currently expects a Flockence HTTPS origin under oriya.si. The public flockence.com origin requires a coordinated, explicit allow-list change and matching callback configuration.

## Security and launch gaps

| Area | Existing behavior | Release status |
| --- | --- | --- |
| Registration | Local signup runs against the installation farm. Team invitations and first-owner creation use the same registration endpoint. | Release blocker for public registration. Introduce a separate verified signup flow and provision farm, owner, Free membership, usage and session atomically. |
| Tenant database | Prisma scopes farm-owned and selected child models. Existing two-farm tests exercise reads, writes and encrypted Oriya links. | Release blocker. Audit nested writes, raw access, scheduled tasks and privately stored files. Verify database-level enforcement independently. |
| Oriya | Signed SSO and provisioning exist, with Redis-backed one-use codes and plan checks in the consolidation branch. | Release blocker. Verify the deployed counterpart and implement immediate entitlement enforcement, revocation and a double-verified linking flow. |
| Cameras | The app has role and farm checks, but the sidecar serves one installation farm. | Release blocker for multi-farm camera rollout. Provision tenant-specific service access and credentials before exposing the feature. |
| Sensors and storage | The app has scoped readings and private Farm Vision storage. | Release blocker. Add server-side feature gates, quota accounting and concurrent enforcement before onboarding farms. |
| Theme and Settings | Existing themes and appearance controls are already present. | Release blocker for the requested tiered experience. Use a server-validated theme registry and retain the existing Premium themes. |
| Deployment | The trial login works over HTTPS and a database dump was restored. The repository documents an unfinished production migration baseline. | Release blocker. Test reviewed migrations against a recent restored database. Verify monitoring and scheduled encrypted backups that include private media. |
| Statistics | The launch brief specifies opt-in reporting and aggregate suppression. | Requires implementation and independent privacy assessment before publication. |

## This branch

The signup lock fix already in the parent draft has been applied to the team role and flock-operation lock calls. The CI database job runs the farm-isolation regression suite against a disposable PostgreSQL database. No production migration or environment change is part of this branch.
