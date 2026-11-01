# CI runner and release blocker investigation

**Status as of 2026-10-30: release blocked.** This document records the observed evidence and safe next checks. It does not claim that GitHub billing is the cause.

## Latest observed workflow

- Workflow: `Chicken Op CI`
- Latest observed PR workflow run after the latest product commits: run 1611
- Run ID: `41076806192`
- Job: `Validate database, types and production build`
- Job ID: `124135056716`
- Conclusion: `failure`
- GitHub's job summary response reports `steps: null`
- No job log URL or diagnostic artifact is exposed by the job/artifact APIs.
- The newer daily-round, food-safety checklist and offline daily-flock capture commits therefore still have no executed application test, Prisma, TypeScript or production-build result.

The same pre-step failure pattern has repeated across earlier pull-request runs and remains unresolved after the farm-calendar, processor-dispatch, cold-chain and capacity-monitoring updates. The application test, Prisma, TypeScript and production-build commands therefore have not been verified by GitHub Actions. A red check with no executed steps is not evidence that those commands failed; it is also not evidence that they passed.

## First account-side checks

The repository is private. GitHub's Actions billing documentation explains that private repositories consume the account's included GitHub-hosted runner minutes and that additional use depends on the account's billing configuration. Check the owning GitHub account's:

1. **Settings → Billing and licensing → Usage**: review GitHub Actions compute minutes, included allowance, current usage and billing-cycle reset.
2. **Settings → Billing and licensing → Budgets**: inspect any Actions budget that stops usage when a budget is reached, especially a zero-dollar budget.
3. **Payment status**: check for a failed payment, overdue balance or missing payment method that could block billable use beyond the included allowance.
4. **Repository → Settings → Actions → General**: confirm Actions is enabled, the workflow is allowed, and workflow permissions are not restricted by a policy.
5. **Organization/enterprise policy**, if applicable: check whether policies limit GitHub-hosted runners or restrict the repository.

Official reference: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

These checks require access to the account's billing and repository settings. They cannot be completed from the repository contents API used for this development session.

## Safe diagnostic if hosted runners remain unavailable

A separate manual diagnostic is now committed at `.github/workflows/runner-diagnostic.yml`. To run it, open **Actions → GitHub-hosted runner diagnostic → Run workflow**. It has one `ubuntu-latest` job and one step that prints runner availability metadata. It has no secrets, does not check out the repository, and does not install or run application code. This diagnostic has not been dispatched from this development session.

If this minimal workflow also fails before its first step, the failure is independent of Chicken Op's Prisma, npm or TypeScript commands. Record its run ID and job details for the account administrator.

A self-hosted runner is an alternative for a private repository, but it must be installed and registered deliberately by the repository owner on a trusted, always-on machine. Do not change `runs-on` to `self-hosted` until an online, correctly labelled runner has been registered and secured. Never place a runner on a production database host with broad credentials.

## Deployment is not configured in this repository

The inspected branch contains the application CI workflow, the separate manual runner diagnostic at `.github/workflows/runner-diagnostic.yml`, and an Nginx configuration under `deploy/nginx/`. It does not contain a deployment workflow, Docker Compose release stack, production migration history or an automated rollback procedure. The production host/database credentials and an approved deployment path are not available through this repository connection.

Do not infer a production target from the Nginx configuration. Do not merge and deploy this draft as a workaround for an unavailable CI runner.

## Remaining release gates

- A successful runner-backed CI run covering Prisma validation/generation, unit tests, typecheck and production build.
- A committed dependency lockfile generated from the actual package dependency graph.
- A Prisma migration baseline validated against a protected restore of the existing production database, following [PRODUCTION_DATABASE_MIGRATION_BASELINE.md](PRODUCTION_DATABASE_MIGRATION_BASELINE.md).
- A tested database and private-media backup/restore procedure.
- A documented deployment path, backup checkpoint, smoke test and rollback procedure.
- Phone, tablet and desktop acceptance walkthroughs, including role-based access and traceability.

Until these gates are completed, PR #4 must remain a draft and no production deployment should be started.
