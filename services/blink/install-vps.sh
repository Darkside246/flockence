#!/usr/bin/env bash
# Install the camera sidecar on the Ubuntu VPS. Run with sudo.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo "Run this installer with sudo." >&2; exit 1; }

service=flockence.service
camera=flockence-blink.service
unit=/etc/systemd/system/$camera
dropin=/etc/systemd/system/$service.d/blink.conf
token_file=/etc/flockence/blink-token.env
camera_env=/etc/flockence/blink-service.env
state=/var/lib/flockence-blink

systemctl show "$service" --no-pager -p User -p Group -p WorkingDirectory -p ExecStart
systemctl is-active --quiet "$service"
[[ $(systemctl show -p User --value "$service") == flockence ]]
app=$(systemctl show -p WorkingDirectory --value "$service")
[[ $# -le 1 ]] || { echo "Usage: install-vps.sh [prepared release app directory]" >&2; exit 1; }
source_app=$(readlink -e -- "${1:-$app}")
[[ $source_app == /opt/* && -d "$source_app/services/blink" ]]
[[ $app == /opt/* && -d "$app/services/blink" ]]
for target in "$unit" "$dropin" "$token_file" "$camera_env" "$state" "$app/services/blink/data"; do
  if [[ -e "$target" || -L "$target" ]]; then
    printf 'Existing camera path found at %s. Review it before installing.\n' "$target" >&2
    exit 1
  fi
done
if [[ $(systemctl show -p LoadState --value "$camera") != not-found ]] ||
   [[ -n $(ss -H -ltn 'sport = :8765') ]]; then
  echo "An existing camera unit or listener needs review first." >&2
  exit 1
fi

if [[ $(dpkg -s python3-venv ffmpeg 2>/dev/null | awk '/^Status: install ok installed$/ { count++ } END { print count+0 }') != 2 ]]; then
  apt-get update
  apt-get install -y --no-install-recommends python3-venv ffmpeg
fi

release=$(mktemp -d /opt/flockence-blink.XXXXXX)
chown flockence:flockence "$release"
chmod 0750 "$release"
revision=$(runuser -u flockence -- git -C "$source_app" rev-parse HEAD)
runuser -u flockence -- git -C "$source_app" archive "$revision" services/blink |
  runuser -u flockence -- tar -xf - -C "$release"
runuser -u flockence -- /usr/bin/python3 -m venv "$release/venv"
runuser -u flockence -- "$release/venv/bin/python" -m pip install \
  -r "$release/services/blink/requirements.txt"

install -d -m 0755 "$(dirname "$dropin")"
if [[ ! -d /etc/flockence ]]; then
  install -d -m 0700 /etc/flockence
fi
restarting_app=0
rollback() {
  trap - EXIT
  set +e
  systemctl stop "$camera" 2>/dev/null
  rm -f -- "$dropin" "$unit" "$token_file" "$camera_env"
  rmdir -- "$state" 2>/dev/null || true
  systemctl daemon-reload
  if [[ $restarting_app == 1 ]]; then
    systemctl restart "$service"
  fi
  echo "Camera setup stopped. Inspect the journal for flockence-blink.service and flockence.service." >&2
}
trap 'status=$?; if [[ $status != 0 ]]; then rollback; fi; exit "$status"' EXIT
umask 077

# Read only camera settings from the active Next.js environment files.
runuser -u flockence -- /usr/local/bin/node - "$app" <<'JS' | /usr/bin/python3 -c '
import base64, json, pathlib, re, secrets, sys

settings = json.load(sys.stdin)
url = settings.pop("BLINK_SIDECAR_URL", "").rstrip("/")
if url and url != "http://127.0.0.1:8765":
    sys.exit("An existing camera URL needs review before installing.")
if settings.pop("BLINK_DATA_DIR", ""):
    sys.exit("An existing camera data directory needs review before installing.")

token = settings.pop("BLINK_SIDECAR_TOKEN", "") or secrets.token_hex(32)
if not re.fullmatch(r"[A-Za-z0-9_\-]{32,128}", token):
    sys.exit("The existing camera token needs review before installing.")
key = settings.get("BLINK_CREDENTIALS_KEY", "").strip() or base64.b64encode(secrets.token_bytes(32)).decode()
try:
    valid_key = len(base64.b64decode(key, validate=True)) == 32
except ValueError:
    valid_key = False
if not valid_key:
    sys.exit("The existing Blink encryption key is invalid.")
settings["BLINK_CREDENTIALS_KEY"] = key

def quote(value):
    if "\n" in value or "\r" in value or "\x00" in value:
        sys.exit("A camera setting contains an invalid character.")
    for char in ("\\", "\"", "$", chr(96)):
        value = value.replace(char, "\\" + char)
    return "\"" + value + "\""

for path, content in (
    (sys.argv[1], "BLINK_SIDECAR_TOKEN=" + token + "\n"),
    (sys.argv[2], "".join(f"{name}={quote(value)}\n" for name, value in settings.items() if value)),
):
    with pathlib.Path(path).open("x") as output:
        output.write(content)
' "$token_file" "$camera_env"
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const values = {};
const app = process.argv[2];
for (const file of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  const candidate = path.join(app, file);
  if (fs.existsSync(candidate)) {
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(candidate, "utf8")))) {
      values[key] ??= value;
    }
  }
}
const allowed = [
  "BLINK_SIDECAR_URL", "BLINK_SIDECAR_TOKEN", "BLINK_DATA_DIR",
  "BLINK_CREDENTIALS_KEY", "BLINK_IMPERSONATE", "BLINK_DNS_SERVERS",
  "BLINK_LIVE_MODE", "BLINK_LIVE_MAX_SECONDS", "FFMPEG_PATH",
  "BLINK_ARCHIVE_CAMERAS", "BLINK_ARCHIVE_KEEP_DAYS", "BLINK_ARCHIVE_MAX_MIB",
  "CAMERA_RECORD_KEEP_DAYS", "CAMERA_SEGMENT_SECONDS",
];
process.stdout.write(JSON.stringify(Object.fromEntries(allowed.map(
  (name) => [name, values[name] ?? ""],
))));
JS

cat > "$unit" <<EOF
[Unit]
Description=Flockence Blink camera service
After=network.target
PartOf=$service
StartLimitIntervalSec=60
StartLimitBurst=4

[Service]
Type=exec
User=flockence
Group=flockence
WorkingDirectory=$release/services/blink
EnvironmentFile=$token_file
EnvironmentFile=$camera_env
Environment=BLINK_DATA_DIR=$state
StateDirectory=flockence-blink
StateDirectoryMode=0700
UMask=0077
ExecStart=$release/venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8765
Restart=on-failure
RestartSec=5s
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
EOF

systemd-analyze verify "$unit"
systemctl daemon-reload
systemctl start "$camera"

# Confirm that the private endpoint answers using the shared token.
# Read the token from its file so it stays out of process arguments.
check_camera() {
/usr/bin/python3 - "$token_file" <<'PY'
import json
import pathlib
import sys
import time
import urllib.request

token = pathlib.Path(sys.argv[1]).read_text().strip().split("=", 1)[1]
request = urllib.request.Request(
    "http://127.0.0.1:8765/status", headers={"X-Sidecar-Token": token}
)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(20):
    try:
        with opener.open(request, timeout=2) as response:
            status = json.load(response)
        print(f"Camera service ready. Blink connected: {status['connected']}. FFmpeg available: {status['ffmpeg']}.")
        break
    except OSError:
        time.sleep(1)
else:
    sys.exit("Camera service did not answer the authenticated status check.")
PY
}
check_camera

cat > "$dropin" <<EOF
[Unit]
Wants=$camera
After=$camera

[Service]
EnvironmentFile=$token_file
Environment=BLINK_SIDECAR_URL=http://127.0.0.1:8765
EOF
systemctl daemon-reload
restarting_app=1
systemctl restart "$service"
curl -fsSL --retry 6 --retry-all-errors --retry-delay 1 --max-time 10 \
  -o /dev/null -w 'Flockence login HTTP %{http_code}\n' https://flockence.com/login
check_camera
systemctl is-active "$service"
systemctl is-active "$camera"
printf 'Camera source revision: %s\n' "$revision"
