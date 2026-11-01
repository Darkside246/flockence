# Production database migration baseline

**Status: not yet baselined. Do not run production migrations from this branch until this procedure has been completed and reviewed.**

## Why this is a release gate

The current repository has `prisma/schema.prisma` but no `prisma/migrations/` history. The actual production database and its schema have not been inspected from this development session. A schema file alone does not establish which SQL changes have already been applied to a live database.

The application must not treat `prisma db push` as its production deployment process. The CI workflow uses `prisma db push` only against a disposable PostgreSQL service created for that CI run. Production must use a reviewed, committed Prisma Migrate history.

## Non-negotiable safeguards

- Never run `prisma migrate reset`, `db push`, or an unreviewed migration against production.
- Do not assume the live database exactly matches the checked-in Prisma schema.
- Take a PostgreSQL backup and a backup of the private Farm Vision storage directory before any schema or application deployment.
- Complete a restore test into a separate database before making a production change.
- Perform the initial work against an isolated restore of production, not against the live database.
- Keep the original backup immutable until the migration and application have been accepted.
- Use the exact Prisma CLI version pinned in `package.json` (currently 6.19.3) for baseline generation and validation.

## Baseline procedure

### 1. Create a protected staging copy

1. Schedule a maintenance window or otherwise ensure the staging copy is transactionally consistent.
2. Take the database backup using the documented backup process in [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
3. Back up the private media volume separately. PostgreSQL backups do not contain the files in `VISION_STORAGE_DIR`.
4. Restore the backup into a separate, isolated staging database. Do not point staging commands at the production connection string.
5. Record the source database name, backup timestamp, PostgreSQL version, and application commit used for the exercise.

### 2. Introspect the restored database

Work from the restored staging database. Preserve the checked-in target schema before introspection:

```bash
cp prisma/schema.prisma prisma/production-baseline.schema.prisma
```

Set `DATABASE_URL` to the restored staging database only, then introspect into the separate schema file:

```bash
npx prisma db pull --schema prisma/production-baseline.schema.prisma
```

Review the introspected file and compare it with the checked-in `prisma/schema.prisma`. The introspected file represents the database that actually exists; the checked-in schema represents the application target. Do not overwrite the target schema with the introspected copy.

Prisma's schema diff does not capture every PostgreSQL feature. Separately inspect extensions, views, triggers, custom functions, check constraints, partial indexes, grants, row-level security policies, and other database objects that may not be represented in Prisma Schema Language. Preserve and script any required objects explicitly.

### 3. Generate a baseline for the schema that already exists

Create the baseline from the introspected staging schema, not from an assumption about the live schema:

```bash
mkdir -p prisma/migrations/0_baseline
npx prisma migrate diff \
  --from-empty \
  --to-schema prisma/production-baseline.schema.prisma \
  --script > prisma/migrations/0_baseline/migration.sql
```

Review the generated SQL carefully. It should describe the existing schema, including its enums, tables, constraints, indexes, and relations. Manually add any required PostgreSQL objects identified in the previous step.

This migration is a historical baseline. It is not intended to be executed on an existing database that already contains those objects.

### 4. Generate the forward change from the existing schema to the application target

Generate a separate forward-only migration that moves the introspected schema to the checked-in application schema:

```bash
mkdir -p prisma/migrations/20261029000000_reconcile_application_schema
npx prisma migrate diff \
  --from-schema prisma/production-baseline.schema.prisma \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/20261029000000_reconcile_application_schema/migration.sql
```

Review every statement for data loss, table or column recreation, unsafe type casts, default changes, enum changes, lock-heavy operations, and changes that require a staged expand/backfill/contract deployment. Add explicit data migration SQL where a schema diff alone cannot safely transform existing rows. If no SQL difference exists, do not add an empty reconciliation migration.

### 5. Test migration history on the restored staging database

The staging database already contains the baseline schema. Mark the baseline as applied there without executing its SQL, then deploy only the forward migration(s):

```bash
npx prisma migrate resolve --applied 0_baseline
npx prisma migrate deploy
npx prisma migrate status
```

Run the complete application checks against this migrated staging database:

```bash
npx prisma validate
npx prisma generate
npm test
npm run typecheck
npm run build
```

Then verify the application workflows with representative data: sign-in and roles, broiler and layer flocks, backdated and same-day mortality, daily flock checks, weights, egg collections, withdrawal holds, FIFO packing, sales, inventory movements, exports, and Farm Vision image access. Compare row counts and critical financial/stock balances before and after. Validate that all data and private media remain accessible.

Also test the migration history against a newly created empty PostgreSQL database. On an empty database, run `npx prisma migrate deploy` without resolving the baseline first; this proves that the committed baseline plus subsequent migrations can construct the intended schema from scratch.

### 6. Production application

Only after staging validation and approval:

1. Take a fresh production database backup and private-media backup.
2. Confirm the production database is at the exact schema state represented by the committed baseline.
3. Point the production release process at the production database.
4. Run `npx prisma migrate resolve --applied 0_baseline` once, only if the baseline has not already been recorded and only after the schema comparison has confirmed it matches.
5. Run `npx prisma migrate deploy` to apply only the reviewed forward migrations.
6. Run `npx prisma migrate status` and the production smoke checks.
7. Record the migration commit, deployment commit, backup identifier, operator, and verification results.

If the production schema does not match the baseline, stop. Do not force-resolve the baseline and do not run the generated SQL. Re-introspect the actual database, create a corrected baseline or additional forward migration, and repeat the staging process.

## CI after migrations are committed

The present CI workflow uses `prisma db push` only to validate the schema against its disposable PostgreSQL service. Once a reviewed migration history is committed, replace that CI step with `npx prisma migrate deploy`. CI should continue to test both an empty database and the supported migration path. Production deployment must never use the disposable CI database instructions.

## Release acceptance

This work is complete only when:

- The full migration history is committed under `prisma/migrations/`.
- The baseline was compared with a restored copy of the current production database.
- All new forward migrations have been tested on that restored copy.
- The same history builds a clean empty database.
- Backup and private-media restore were demonstrated.
- Financial balances, bird counts, inventory balances, withdrawal holds, and traceability were checked after migration.
- The responsible operator has recorded explicit approval for the production change.

Until those conditions are met, the production migration gate remains open and this PR must stay in draft.
