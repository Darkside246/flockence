# Chicken Op branch consolidation record

**Date:** 2026-10-28  
**Decision:** Use PR #3's farmer command-centre branch as the consolidation baseline. Keep the result in draft until CI and operational acceptance tests pass.

## Verified repository state

Repository: `Darkside246/chicken-op`

- PR #1: `feat/farm-os-foundation-2026-10-05`, 543 commits, 287 changed files, draft, latest observed CI run failed.
- PR #2: `feat/poultry-lifecycle-processing-2026-10-07`, 16 commits, draft.
- PR #3: `feat/weather-aura-farmer-automation-2026-10-07`, 116 commits, 50 changed files, draft, latest observed CI run failed.
- Comparing PR #2's head to PR #3's head showed PR #3 ahead by 100 commits and not behind. PR #3 therefore already contains the lifecycle/processing line of work from PR #2.
- PR #1 is a separate, diverged line of development. It overlaps with PR #3 in important application files, including the Prisma schema, batches, operations, slaughter, inventory and sales.
- The latest visible workflow-run records were failures for PR #1 and PR #3. The old job-log artifacts were no longer retrievable during this assessment, so the precise failing step must be reproduced in a fresh run.

## Consolidation approach

### Keep as baseline
Use `feat/weather-aura-farmer-automation-2026-10-07` as the application baseline because it includes the poultry lifecycle and farmer workflow evolution without importing the entire separate platform branch.

### Supersede
PR #2 is redundant as a separate merge target once the full lifecycle/processing work is included in the PR #3 baseline. Retain its commits in history and close it as superseded only after the consolidated PR is validated.

### Selectively integrate from PR #1
Do not merge PR #1 wholesale. Its 543-commit / 287-file scope is too broad to combine safely without a dependency and schema review. Inventory every candidate and integrate only validated, self-contained improvements:
- PostgreSQL-backed CI and Prisma validation.
- reproducible runtime and dependency versions.
- private Farm Vision media storage and authenticated media delivery.
- backup/restore verification and operational health checks.
- authentication, tenant scoping, rate limits and audit protections.
- device/sensor and actuator gateways only after their deployment and safety boundaries are separately tested.

Every selected item must include its dependent files, schema changes, environment documentation and tests. Never copy an isolated route or UI file whose service/model dependencies are absent.

## Release safety rules

- Do not merge any PR while its latest required checks are failing.
- Do not force-push or rewrite the source feature branches.
- Do not discard PR #1; preserve it as a source and comparison branch until the selected foundation improvements are accounted for.
- Use a new consolidation branch based on the PR #3 head for broiler/layer and UX work.
- Resolve overlaps by feature ownership and domain rules, not by choosing the newest file blindly.
- Schema changes require a reviewed production migration and a tested upgrade path from the currently deployed database. CI may use `prisma db push` for disposable test databases, but production must not rely on an undocumented schema push.
- Sales, AURA confirmations, household consumption, processing and egg collection must use the same inventory ledger and idempotency rules.
- Broiler harvest logic must never apply to layer flocks.

## Consolidation acceptance checklist

- [ ] Current PR #3 baseline reproduced with a fresh CI run.
- [ ] PostgreSQL service, Prisma validate/generate and disposable-database schema check pass.
- [ ] TypeScript and production build pass.
- [ ] Broiler lifecycle/partial slaughter/processing tests pass.
- [ ] Layer collection/grade/stock tests pass.
- [ ] Withdrawal and sale restrictions pass at the API/service layer.
- [ ] Inventory movement reconciliation passes for manual sale and AURA order confirmation.
- [ ] Private-media, backup/restore and auth improvements from PR #1 have dependency-mapped follow-up changes.
- [ ] Upgrade migration is tested against a copy of the current production database.
- [ ] Owner/operator phone and desktop walkthroughs pass.

## Result of this change

This change creates a safer working line from the PR #3 baseline. It does not claim that the two divergent histories have already been merged or that production deployment is complete. PR #1 remains an audited source branch until its selected platform improvements are integrated and tested.
