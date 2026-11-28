#!/usr/bin/env bash
# Give one more farm its own private camera worker (docs/FARM_CAMERA_SECURITY.md). Run with sudo on the VPS:
#
#   sudo bash /opt/flockence-release-<short>/app/ops/cameras/add-farm-camera-worker.sh <farm-id>
#   sudo bash .../add-farm-camera-worker.sh --list
#
# Each farm other than the home farm gets: a separate non-login Unix account, a private state directory, its own random
# token and Blink encryption key (encryption required), and its own loopback port. The app learns about it through a
# root-owned FLOCKENCE_CAMERA_WORKERS file; lib/blink-sidecar.ts gives each farm only its own worker. The home farm keeps
# the existing flockence-blink.service (services/blink/install-vps.sh, which must already be installed: its code is reused).
# Nothing is changed for other farms. Any failure undoes this farm's half-made worker and leaves the app as it was.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo "Run this with sudo." >&2; exit 1; }

service=flockence.service
base_camera=flockence-blink.service
workers_env=/etc/flockence/camera-workers.env
workers_dropin=/etc/systemd/system/$service.d/camera-workers.conf

list_workers() {
  if [[ -f $workers_env ]]; then
    /usr/bin/python3 - "$workers_env" <<'PY'
import json, pathlib, shlex, sys
text = pathlib.Path(sys.argv[1]).read_text()
value = shlex.split(text.split("=", 1)[1])[0] if "=" in text else "{}"
for farm, worker in sorted(json.loads(value or "{}").items()):
    print(f"{farm}: {worker['url']}")
PY
  else
    echo "No extra farm camera workers yet."
  fi
}

[[ $# == 1 ]] || { echo "Usage: add-farm-camera-worker.sh <farm-id> | --list" >&2; exit 1; }
if [[ $1 == --list ]]; then list_workers; exit 0; fi
farm=$1
[[ $farm =~ ^[A-Za-z0-9_-]{3,64}$ ]] || { echo "That is not a farm id." >&2; exit 1; }

systemctl is-active --quiet "$service" || { echo "$service is not running." >&2; exit 1; }
app=$(systemctl show -p WorkingDirectory --value "$service")
[[ $app == /opt/* ]] || { echo "Unexpected app directory: $app" >&2; exit 1; }
home_farm=$(runuser -u flockence -- /usr/local/bin/node -e '
const fs=require("fs"),path=require("path"),{parseEnv}=require("util");let v;
for (const f of [".env.production.local",".env.local",".env.production",".env"]) { const p=path.join(process.argv[1],f);
  if (fs.existsSync(p)) v ??= parseEnv(fs.readFileSync(p,"utf8")).FARM_ID; }
process.stdout.write(v || "default-farm");' "$app")
[[ $farm != "$home_farm" ]] || { echo "$farm is the home farm; it uses $base_camera." >&2; exit 1; }

# The farm must exist. (Its id is already limited to letters, digits, _ and -.)
database=$(runuser -u flockence -- /usr/local/bin/node -e '
const fs=require("fs"),path=require("path"),{parseEnv}=require("util");let v;
for (const f of [".env.production.local",".env.local",".env.production",".env"]) { const p=path.join(process.argv[1],f);
  if (fs.existsSync(p)) v ??= parseEnv(fs.readFileSync(p,"utf8")).DATABASE_URL; }
process.stdout.write(new URL(v).pathname.slice(1));' "$app")
[[ $database =~ ^[A-Za-z0-9_]+$ ]] || { echo "Could not read the database name." >&2; exit 1; }
exists=$(echo "SELECT count(*) FROM \"Farm\" WHERE id = :'farm';" | sudo -u postgres psql -At -v farm="$farm" "$database")
[[ $exists == 1 ]] || { echo "No farm with id $farm in the database." >&2; exit 1; }

[[ $(systemctl show -p LoadState --value "$base_camera") == loaded ]] || { echo "Install the home camera service first (services/blink/install-vps.sh)." >&2; exit 1; }
code=$(systemctl show -p WorkingDirectory --value "$base_camera")
release=${code%/services/blink}
[[ $release == /opt/flockence-blink.* && -x $release/venv/bin/python ]] || { echo "Unexpected camera code at $code" >&2; exit 1; }

tag=$(printf '%s' "$farm" | sha256sum | cut -c1-10)
user=fcam-$tag
unit=flockence-cam-$tag.service
unit_path=/etc/systemd/system/$unit
farm_env=/etc/flockence/camera-$tag.env
state=/var/lib/flockence-cam-$tag
for target in "$unit_path" "$farm_env" "$state"; do
  [[ ! -e $target ]] || { echo "$farm already has a camera worker ($target). Use --list." >&2; exit 1; }
done
if grep -q "\"$farm\"" "$workers_env" 2>/dev/null; then echo "$farm is already listed in $workers_env." >&2; exit 1; fi

# A free loopback port from 8766, not used by another worker.
port=""
for candidate in $(seq 8766 8899); do
  if [[ -z $(ss -H -ltn "sport = :$candidate") ]] && ! grep -q "127.0.0.1:$candidate\"" "$workers_env" 2>/dev/null; then port=$candidate; break; fi
done
[[ -n $port ]] || { echo "No free port between 8766 and 8899." >&2; exit 1; }

created_user=0
touched_app=0
rollback() {
  trap - EXIT
  set +e
  systemctl stop "$unit" 2>/dev/null
  rm -f -- "$unit_path" "$farm_env"
  [[ -f $workers_env.before-$tag ]] && mv -f -- "$workers_env.before-$tag" "$workers_env"
  [[ $created_user == 1 ]] && userdel "$user" 2>/dev/null
  rm -rf -- "$state"
  systemctl daemon-reload
  [[ $touched_app == 1 ]] && systemctl restart "$service"
  echo "Camera worker for $farm was not added; everything made for it was removed and the app is as it was." >&2
}
trap 'status=$?; if [[ $status != 0 ]]; then rollback; fi; exit "$status"' EXIT
umask 077

useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
created_user=1
# The camera code and its virtual environment hold no secrets; the worker account only needs to read and run them.
chmod 0755 "$release"

/usr/bin/python3 - "$farm_env" <<'PY'
import base64, pathlib, secrets, sys
token = secrets.token_hex(32)
key = base64.b64encode(secrets.token_bytes(32)).decode()
with pathlib.Path(sys.argv[1]).open("x") as out:
    out.write(f"BLINK_SIDECAR_TOKEN={token}\nBLINK_CREDENTIALS_KEY={key}\nBLINK_REQUIRE_ENCRYPTION=1\n")
PY
chmod 0600 "$farm_env"

cat > "$unit_path" <<EOF
[Unit]
Description=Flockence camera worker for farm $farm
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=4

[Service]
Type=exec
User=$user
Group=$user
WorkingDirectory=$code
EnvironmentFile=$farm_env
Environment=BLINK_DATA_DIR=$state
StateDirectory=flockence-cam-$tag
StateDirectoryMode=0700
UMask=0077
ExecStart=$release/venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port $port
Restart=on-failure
RestartSec=5s
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
EOF
systemd-analyze verify "$unit_path"
systemctl daemon-reload
systemctl enable --now "$unit"

/usr/bin/python3 - "$farm_env" "$port" <<'PY'
import json, pathlib, sys, time, urllib.request
token = [l.split("=", 1)[1] for l in pathlib.Path(sys.argv[1]).read_text().splitlines() if l.startswith("BLINK_SIDECAR_TOKEN=")][0]
request = urllib.request.Request(f"http://127.0.0.1:{sys.argv[2]}/status", headers={"X-Sidecar-Token": token})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(20):
    try:
        with opener.open(request, timeout=2) as response:
            json.load(response)
        print("Farm camera worker is answering.")
        break
    except OSError:
        time.sleep(1)
else:
    sys.exit("The farm camera worker did not answer.")
PY

# Add it to the app's list (root-owned file; the app reads it through a systemd drop-in).
touched_app=1
[[ -f $workers_env ]] && cp -p -- "$workers_env" "$workers_env.before-$tag"
/usr/bin/python3 - "$workers_env" "$farm" "$port" "$farm_env" <<'PY'
import json, pathlib, shlex, sys
path, farm, port, env = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], pathlib.Path(sys.argv[4])
workers = {}
if path.exists():
    text = path.read_text()
    if "=" in text:
        workers = json.loads(shlex.split(text.split("=", 1)[1])[0] or "{}")
token = [l.split("=", 1)[1] for l in env.read_text().splitlines() if l.startswith("BLINK_SIDECAR_TOKEN=")][0]
workers[farm] = {"url": f"http://127.0.0.1:{port}", "token": token}
path.write_text("FLOCKENCE_CAMERA_WORKERS=" + shlex.quote(json.dumps(workers, separators=(",", ":"))) + "\n")
path.chmod(0o600)
PY
install -d -m 0755 "$(dirname "$workers_dropin")"
if [[ ! -f $workers_dropin ]]; then
  printf '[Service]\nEnvironmentFile=%s\n' "$workers_env" > "$workers_dropin"
fi
systemctl daemon-reload
systemctl restart "$service"
curl -fsSL --retry 6 --retry-all-errors --retry-delay 1 --max-time 10 -o /dev/null -w 'Flockence login HTTP %{http_code}\n' https://flockence.com/login
rm -f -- "$workers_env.before-$tag"
trap - EXIT
echo "Farm $farm now has its own camera worker ($unit on 127.0.0.1:$port). Its owner can connect cameras under Cameras."
