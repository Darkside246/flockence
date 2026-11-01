# Production backup and recovery drill

## Database backup

Install PostgreSQL client utilities compatible with the database server. Set `DATABASE_URL` and run:

```bash
npm run backup:verify
```

This creates a custom-format PostgreSQL dump in `BACKUP_DIR` (default: `./backups`), uses restrictive file permissions, and validates that PostgreSQL can read the archive table-of-contents.

## Full restore verification

Create a separate, empty, disposable PostgreSQL database. Never use the production URL as the restore target. Set both variables:

```bash
export RESTORE_DATABASE_URL='postgresql://.../chicken_op_restore'
export RESTORE_CONFIRM=YES
npm run backup:verify
```

The script refuses a restore when the source and target identify the same host, port and database. The restore command is not destructive-clean mode. The destination must be empty. The script then checks that the restored `Farm` table exists.

## Files and recovery scope

Database dumps do not include Farm Vision files. Back up the directory configured by `VISION_STORAGE_DIR` separately, with permissions and encryption appropriate for farm and worker records. Also include application environment configuration in a secure secrets backup, not in the dump directory or source control.

A successful dump and archive listing is not a complete recovery drill. Production readiness requires a full restore into an isolated database, restoration of private media, an application smoke test against the restored environment, and a written record of the tested backup timestamp and outcome.

Do not automate deletion of old backups until retention requirements and at least one independent recovery copy have been agreed.
