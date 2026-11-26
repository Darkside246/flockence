#!/usr/bin/env bash
# Start the local database and camera as dependencies of the live Flockence unit.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ $# -eq 0 ]] || { echo "Run from a verified Flockence release checkout." >&2; exit 1; }

service=flockence.service
camera=flockence-blink.service
source_app=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
app=$(systemctl show "$service" --property=WorkingDirectory --value)
pid=$(systemctl show "$service" --property=MainPID --value)
[[ $source_app == /opt/* && $app == /opt/* && -d "$app" ]]
[[ $(systemctl show "$service" --property=User --value) == flockence ]]
[[ $pid =~ ^[1-9][0-9]*$ ]] || { echo "Start the existing Flockence service before attaching its dependencies." >&2; exit 1; }

# The database URL can come from systemd or Next's environment files. Return only the local port.
port=$(/usr/local/bin/node - "$pid" "$app" <<'JS'
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { parseEnv } = require("node:util");
const [pid, app] = process.argv.slice(2);
const fromProcess = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")
  .find((variable) => variable.startsWith("DATABASE_URL="));
let address = fromProcess?.slice("DATABASE_URL=".length);
for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  if (address) break;
  try { address = parseEnv(readFileSync(join(app, name), "utf8")).DATABASE_URL; }
  catch (error) { if (error.code !== "ENOENT") process.exit(1); }
}
try {
  const url = new URL(address);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) throw new Error();
  process.stdout.write(url.port || "5432");
} catch {
  console.error("The active release does not declare a supported local PostgreSQL address.");
  process.exit(1);
}
JS
)
mapfile -t clusters < <(pg_lsclusters --no-header | awk -v port="$port" '$3 == port { print $1 ":" $2 }')
if [[ ${#clusters[@]} != 1 || ! ${clusters[0]} =~ ^([0-9]+):([a-zA-Z0-9_]+)$ ]]; then
  echo "Could not identify one local PostgreSQL cluster for the active database port." >&2
  exit 1
fi
postgres="postgresql@${BASH_REMATCH[1]}-${BASH_REMATCH[2]}.service"
systemctl start "$postgres"
systemctl is-active --quiet "$postgres"

if [[ $(systemctl show "$camera" --property=LoadState --value) == not-found ]]; then
  bash "$source_app/services/blink/install-vps.sh" "$source_app"
fi
# The existing installer owns the private camera token and restart behavior.
if ! grep -Fxq "Wants=$camera" "/etc/systemd/system/$service.d/blink.conf" ||
   ! grep -Fxq "After=$camera" "/etc/systemd/system/$service.d/blink.conf"; then
  echo "The camera service already uses a custom setup. Verify its dependency before changing startup." >&2
  exit 1
fi

folder="/etc/systemd/system/$service.d"
dropin="$folder/local-postgresql.conf"
install -d -m 0755 "$folder"
tmp=$(mktemp)
trap 'rm -f -- "$tmp"' EXIT
printf '[Unit]\nRequires=%s\nAfter=%s\n' "$postgres" "$postgres" > "$tmp"
if [[ -L $dropin ]] || { [[ -e $dropin ]] && ! cmp -s -- "$tmp" "$dropin"; }; then
  echo "A different local database startup policy is already installed." >&2
  exit 1
fi
if [[ ! -e $dropin ]]; then
  install -m 0644 "$tmp" "$dropin"
fi

systemctl daemon-reload
systemctl enable --now "$service"
systemctl start "$camera"
for unit in "$postgres" "$camera" "$service"; do
  systemctl is-active --quiet "$unit"
  printf '%s is active.\n' "$unit"
done
printf 'Active Flockence revision: '
runuser -u flockence -- git -C "$app" rev-parse HEAD
curl -fsSL --retry 4 --retry-delay 1 --retry-all-errors --max-time 10 \
  -o /dev/null -w 'Flockence login HTTP %{http_code}\n' https://flockence.com/login
