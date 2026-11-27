# Deploying a release to flockence.com

`ops/release/switch-release.sh` moves `flockence.service` to a new release checkout. The live site keeps running until
the final switch.

1. **Check.** It reads the live release, its settings and its database without changing anything, and prints what it
   found. It never prints a secret.
2. **Build.** It copies the live release's `.env*` settings files into the new checkout and links the private
   `storage/` and `public/uploads` folders, so Farm Vision pictures and Oriya frames stay where they are. Then it runs
   `npm ci`, `prisma generate` and `npm run build` as `flockence`, with one build worker by default
   (`NEXT_BUILD_CPUS=1`).
3. **Backup.** It writes a custom-format `pg_dump` to `/var/backups/flockence-before-<rev>-<time>.dump`, readable by
   root only, and verifies it with `pg_restore --list`.
4. **Database.** It applies the additive SQL in `ops/postgres/` in order:
   1. `add-health-case-lifecycle.sql`
   2. `add-bird-ledger.sql`
   3. `add-feed-water-eggs.sql`
   4. `add-suppliers-feed-catalogue.sql`
   5. `add-vision-findings.sql` (from Vision Intelligence phase 1)

   Each file runs in a single transaction and is safe to run twice. When the service uses `FARM_RLS_DATABASE_URL`, it
   also re-applies `farm-tenant-access.sql`, so the new tables get the farm boundary.
5. **Switch.** It writes `/etc/systemd/system/flockence.service.d/zz-release.conf`, which sets the new
   `WorkingDirectory` and start command and sorts after older release drop-ins. Then it restarts the service.
6. **Verify.** It waits for `/login` on the internal port and checks that the running checkout is the new revision. If
   either check fails, it restores the previous drop-in and restarts the old release by itself. The database changes
   stay, because they only add tables and columns, and the old release ignores them.

## Commands (as `flockadmin` on the VPS)

Replace `<sha>` with the commit to deploy and `<short>` with its first seven characters.

```bash
sudo install -d -o flockence -g flockence /opt/flockence-release-<short>
sudo -u flockence -H git clone https://github.com/Darkside246/flockence.git /opt/flockence-release-<short>/app
sudo -u flockence -H git -C /opt/flockence-release-<short>/app checkout --detach <sha>
sudo bash /opt/flockence-release-<short>/app/ops/release/switch-release.sh --check
sudo bash /opt/flockence-release-<short>/app/ops/release/switch-release.sh
```

Read the `--check` output before switching. These items should look right:
- the live release
- the database name and user
- "New tables already present: 0 of 4" on the first run
- the settings files to copy
- the private folders to share
- the free disk space (a build needs about 1.5 GB)

## Afterwards

- Open https://flockence.com and sign in.
- Try a daily check with a dead-bird count, a feed entry in bags, Suppliers, the dashboard briefing, Health cases, and
  Cameras → Recordings on a phone.
- The script prints the one-line command that undoes the app switch.
- Keep the old release directory until the new one has been checked, because the undo command uses it.
- Record the deployed revision and backup path in `docs/FLOCKENCE_HANDOFF.md`.

## When it stops

Every stop says what happened and what is still running.

- **Before the backup:** nothing has changed.
- **During the SQL:** the failing file rolls back, and the live site still runs the old release.
- **After the restart:** if the new release does not answer, the script switches the app back by itself.
