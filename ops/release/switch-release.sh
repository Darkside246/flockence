#!/usr/bin/env bash
# Switch flockence.service to a prepared release checkout, safely:
#   check -> build the new release beside the live one -> back up the database -> apply the additive SQL ->
#   re-apply farm row security if it is in use -> switch the service -> verify -> roll back the app if it fails.
#
# The live release keeps running until the switch. The database changes are additive, so the previous release keeps
# working on the updated database, and rolling back the app needs no database restore.
#
# 1. Prepare the release as flockadmin (replace <sha> with the commit to deploy, <short> with its first 7 characters):
#      sudo install -d -o flockence -g flockence /opt/flockence-release-<short>
#      sudo -u flockence -H git clone https://github.com/Darkside246/flockence.git /opt/flockence-release-<short>/app
#      sudo -u flockence -H git -C /opt/flockence-release-<short>/app checkout --detach <sha>
# 2. Check (changes nothing):
#      sudo bash /opt/flockence-release-<short>/app/ops/release/switch-release.sh --check
# 3. Switch:
#      sudo bash /opt/flockence-release-<short>/app/ops/release/switch-release.sh
#
# Secrets are never printed. Guide: docs/DEPLOY_RELEASE.md.
set -euo pipefail
umask 077
export PATH=/usr/local/bin:/usr/bin:/bin

say() { printf '==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf 'STOPPED: %s\n' "$*" >&2; exit 1; }

mode=switch
case "${1:-}" in
  "") ;;
  --check) mode=check ;;
  *) die "Usage: switch-release.sh [--check]" ;;
esac
[[ $(id -u) == 0 ]] || die "Run with sudo."

service=flockence.service
dropin_dir=/etc/systemd/system/$service.d
dropin=$dropin_dir/zz-release.conf
# The SQL this release needs, in order. Each file only adds columns, tables and indexes, and is safe to run twice.
sql_files=(add-health-case-lifecycle.sql add-bird-ledger.sql add-feed-water-eggs.sql add-suppliers-feed-catalogue.sql add-vision-findings.sql)

new_app=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
old_app=$(systemctl show "$service" -p WorkingDirectory --value)
pid=$(systemctl show "$service" -p MainPID --value)
[[ $(systemctl show "$service" -p User --value) == flockence ]] || die "$service does not run as the flockence user."
[[ $new_app == /opt/* ]] || die "Run the script from a release checkout under /opt (it is in $new_app)."
[[ -n $old_app && -d $old_app ]] || die "Could not read the live release directory from $service."
[[ $new_app != "$old_app" ]] || die "This checkout is already the live release."
[[ $pid =~ ^[1-9][0-9]*$ ]] || die "$service is not running. Start it before switching releases."

as_app() { sudo -u flockence -H env PATH="$PATH" "$@"; }
new_rev=$(as_app git -C "$new_app" rev-parse HEAD) || die "$new_app is not a git checkout the flockence user can read."
old_rev=$(as_app git -C "$old_app" rev-parse HEAD 2>/dev/null || echo "unknown (not a git checkout)")
[[ -z $(as_app git -C "$new_app" status --porcelain --untracked-files=no) ]] || die "$new_app has local changes. Use a clean checkout."
for file in "${sql_files[@]}"; do [[ -f $new_app/ops/postgres/$file ]] || die "This checkout has no ops/postgres/$file."; done

say "Flockence release switch ($mode)"
note "Live release:  $old_app"
note "  revision:    $old_rev"
note "New release:   $new_app"
note "  revision:    $new_rev"

# --- the live configuration (read without printing any value) --------------------------------------------------------
# Database settings come from the running service's environment, or from Next's env files in the live release.
read_env() {
  /usr/local/bin/node - "$pid" "$old_app" "$1" <<'JS'
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { parseEnv } = require("node:util");
const [pid, app, key] = process.argv.slice(2);
let value = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").find(v => v.startsWith(key + "="))?.slice(key.length + 1);
for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  if (value) break;
  try { value = parseEnv(readFileSync(join(app, name), "utf8"))[key]; } catch (error) { if (error.code !== "ENOENT") process.exit(1); }
}
if (value) process.stdout.write(value);
JS
}
database_url=$(read_env DATABASE_URL) || die "Could not read the live release's settings."
[[ -n $database_url ]] || die "The live release has no DATABASE_URL."
rls_in_use=no
[[ -n $(read_env FARM_RLS_DATABASE_URL) ]] && rls_in_use=yes
vision_dir=$(read_env VISION_STORAGE_DIR)

# psql and pg_dump get the connection through PG* variables, so it never appears in the process list.
while IFS= read -r -d '' pair; do export "${pair?}"; done < <(/usr/local/bin/node - "$database_url" <<'JS'
const url = new URL(process.argv[2]);
if (!["postgres:", "postgresql:"].includes(url.protocol)) process.exit(1);
const out = { PGHOST: decodeURIComponent(url.hostname.replace(/^\[|\]$/g, "")), PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
const ssl = url.searchParams.get("sslmode"); if (ssl) out.PGSSLMODE = ssl;
for (const [k, v] of Object.entries(out)) if (v) process.stdout.write(`${k}=${v}\0`);
JS
) || die "DATABASE_URL is not a PostgreSQL address."
unset database_url
command -v psql >/dev/null && command -v pg_dump >/dev/null && command -v pg_restore >/dev/null || die "Install the PostgreSQL client tools (psql, pg_dump, pg_restore)."
psql -X -qAt -c "select 1" >/dev/null || die "Could not connect to the live database with the service's settings."
note "Database:      $PGDATABASE on $PGHOST:$PGPORT (as $PGUSER)"
applied=$(psql -X -qAt -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('HealthCaseEvent','BirdMovement','WaterReading','FeedProduct','VisionFinding','CameraPenLink')")
note "New tables already present: $applied of 6"
note "Farm row security (FARM_RLS_DATABASE_URL): $rls_in_use"

# Files that live in the release directory but are not in git: settings and private storage.
env_files=()
for name in .env .env.local .env.production .env.production.local; do [[ -f $old_app/$name ]] && env_files+=("$name"); done
note "Settings files to copy: ${env_files[*]:-none (settings come from systemd)}"
# Private farm files (Farm Vision pictures, Oriya frames) default to storage/ inside the release; legacy uploads to
# public/uploads. The new release points at the same folders, so nothing is copied or lost.
links=()
[[ -e $old_app/storage ]] && links+=("storage")
[[ -d $old_app/public/uploads ]] && links+=("public/uploads")
[[ -n $vision_dir && $vision_dir == /* ]] && note "Farm Vision pictures are kept in $vision_dir (outside the release)."
note "Private folders shared with the new release: ${links[*]:-none}"

port=$(systemctl show "$service" -p ExecStart --value | grep -oE '(-p|--port)[ =][0-9]+' | grep -oE '[0-9]+$' | head -1 || true)
[[ -n $port ]] || port=$(read_env PORT)
port=${port:-3002}
note "Internal address: 127.0.0.1:$port"
exec_line=$(systemctl cat "$service" | grep -E '^ExecStart=.+' | tail -1 | cut -d= -f2-)
[[ -n $exec_line ]] || die "Could not read the service's start command."
note "Disk free under /opt: $(df -h --output=avail /opt | tail -1 | tr -d ' ')"

if [[ $mode == check ]]; then
  say "Check finished. Nothing was changed. Run again without --check to switch."
  exit 0
fi

# --- 1. build the new release beside the live one ---------------------------------------------------------------------
say "Copying settings and linking private folders into the new release"
for name in "${env_files[@]}"; do
  [[ -e $new_app/$name ]] || install -m 600 -o flockence -g flockence "$old_app/$name" "$new_app/$name"
done
for rel in "${links[@]}"; do
  target=$(readlink -f "$old_app/$rel")
  if [[ -e $new_app/$rel && ! -L $new_app/$rel ]]; then
    [[ -z $(ls -A "$new_app/$rel") ]] || die "$new_app/$rel already has files. Move them before switching."
    rmdir "$new_app/$rel"
  fi
  install -d -o flockence -g flockence "$(dirname "$new_app/$rel")"
  ln -sfn "$target" "$new_app/$rel"
  chown -h flockence:flockence "$new_app/$rel"
done

say "Building the new release (the live site keeps running)"
as_app bash -c 'cd "$1" && npm ci --no-audit --no-fund && npx prisma generate && NEXT_BUILD_CPUS="${2:-1}" npm run build' _ "$new_app" "${NEXT_BUILD_CPUS:-1}" \
  || die "The build failed. The live site was not changed."
[[ -f $new_app/.next/BUILD_ID ]] || die "The build did not finish. The live site was not changed."

# --- 2. back up the database ------------------------------------------------------------------------------------------
backup=/var/backups/flockence-before-${new_rev:0:7}-$(date -u +%Y%m%dT%H%M%SZ).dump
say "Backing up the database to $backup"
install -d -m 700 /var/backups
pg_dump --format=custom --file="$backup" || die "The backup failed. Nothing was changed."
chmod 600 "$backup"
pg_restore --list "$backup" >/dev/null || die "The backup could not be read back. Nothing was changed."
note "Backup verified ($(du -h "$backup" | cut -f1))."

# --- 3. database changes (additive) -----------------------------------------------------------------------------------
say "Applying the database changes"
for file in "${sql_files[@]}"; do
  note "$file"
  psql -X -q -v ON_ERROR_STOP=1 --file="$new_app/ops/postgres/$file" \
    || die "$file failed and was rolled back. The live site still runs $old_rev. The backup is $backup."
done
if [[ $rls_in_use == yes ]]; then
  note "farm-tenant-access.sql (farm row security for the new tables)"
  (cd "$new_app/ops/postgres" && psql -X -q -v ON_ERROR_STOP=1 --file=farm-tenant-access.sql) \
    || die "Re-applying farm row security failed and was rolled back. The live site still runs $old_rev."
fi

# --- 4. switch the service --------------------------------------------------------------------------------------------
say "Switching $service to the new release"
previous_dropin=""
if [[ -f $dropin ]]; then
  previous_dropin=/var/backups/flockence-zz-release-before-${new_rev:0:7}.conf
  cp -p "$dropin" "$previous_dropin"
fi
install -d -m 755 "$dropin_dir"
new_exec=${exec_line//"$old_app"/"$new_app"}
printf '# Written by ops/release/switch-release.sh for %s. Sorted last, so it overrides older release drop-ins.\n[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s\n' \
  "$new_rev" "$new_app" "$new_exec" > "$dropin"
chmod 644 "$dropin"
systemctl daemon-reload
if [[ $(systemctl show "$service" -p WorkingDirectory --value) != "$new_app" ]]; then
  if [[ -n $previous_dropin ]]; then cp -p "$previous_dropin" "$dropin"; else rm -f "$dropin"; fi
  systemctl daemon-reload
  die "Another drop-in in $dropin_dir overrides the release directory. Nothing was restarted; review: systemctl cat $service"
fi
systemctl restart "$service"

rollback() {
  say "Rolling the app back to $old_app"
  if [[ -n $previous_dropin ]]; then cp -p "$previous_dropin" "$dropin"; else rm -f "$dropin"; fi
  systemctl daemon-reload
  systemctl restart "$service"
  die "The new release did not start. The app is back on $old_rev. The database changes stay (they are additive). Backup: $backup"
}

say "Waiting for the new release to answer"
ok=no
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$port/login"; then ok=yes; break; fi
  sleep 2
done
[[ $ok == yes ]] || rollback
running=$(as_app git -C "$(systemctl show "$service" -p WorkingDirectory --value)" rev-parse HEAD)
[[ $running == "$new_rev" ]] || rollback
public=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://flockence.com/login || true)

say "Done"
note "Running revision: $running"
note "https://flockence.com/login answered: ${public:-no answer}"
note "Database backup: $backup"
note "Undo the app switch (database stays):"
if [[ -n $previous_dropin ]]; then
  note "  sudo cp -p $previous_dropin $dropin && sudo systemctl daemon-reload && sudo systemctl restart $service"
else
  note "  sudo rm $dropin && sudo systemctl daemon-reload && sudo systemctl restart $service"
fi
