#!/usr/bin/env bash
# Switch on automatic camera vision on the VPS (owner request, 2026-11-27). Run once, from the live release:
#   sudo bash "$(systemctl show flockence.service -p WorkingDirectory --value)/ops/systemd/enable-vision-rounds.sh"
# Add --cameras-on to also switch on camera and live-video inspections (FLOCKENCE_CAMERA_VISION and
# FLOCKENCE_LIVE_CAMERA_VISION) when the server does not have them yet.
#
# It creates the private round token in the app's .env (backed up first), restarts Flockence only if .env changed,
# installs the 10-minute timer and runs one round. Which cameras run, how often, and the daily limit are chosen by the
# farm on the Farm Vision page. No secret is printed.
set -euo pipefail
umask 077
export PATH=/usr/local/bin:/usr/bin:/bin
die() { printf 'STOPPED: %s\n' "$*" >&2; exit 1; }
say() { printf '==> %s\n' "$*"; }
[[ $(id -u) == 0 ]] || die "Run with sudo."
cameras_on=no
case "${1:-}" in "") ;; --cameras-on) cameras_on=yes ;; *) die "Usage: enable-vision-rounds.sh [--cameras-on]" ;; esac

service=flockence.service
app=$(systemctl show "$service" -p WorkingDirectory --value)
pid=$(systemctl show "$service" -p MainPID --value)
[[ -n $app && -d $app && $app == /opt/* ]] || die "Could not find the live Flockence release."
[[ $pid =~ ^[1-9][0-9]*$ ]] || die "Flockence is not running. Start it first."
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ -f $src/flockence-vision-rounds.service && -f $src/flockence-vision-rounds.timer ]] || die "Run this from a Flockence release checkout."
[[ -f $app/scripts/vision-rounds.mjs ]] || die "The live release is older than this feature. Deploy it first."
envfile=$app/.env
[[ -f $envfile ]] || die "The live release has no .env file."

# Is a setting present (in the running service or .env)? Prints yes or no, never the value.
has() {
  if tr '\0' '\n' < "/proc/$pid/environ" | grep -q "^$1=."; then echo yes; return; fi
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1=[\"']?[^\"' ]" "$envfile" && echo yes || echo no
}

changed=no
backup=""
add_setting() {
  if [[ -z $backup ]]; then
    backup=/var/backups/flockence-env-before-vision-$(date -u +%Y%m%dT%H%M%SZ)
    install -d -m 700 /var/backups
    cp -p "$envfile" "$backup"
  fi
  [[ -z $(tail -c1 "$envfile") ]] || printf '\n' >> "$envfile"
  printf '%s=%s\n' "$1" "$2" >> "$envfile"
  changed=yes
}

say "Checking the live release ($app)"
if [[ $(has VISION_ROUNDS_TOKEN) == no ]]; then
  add_setting VISION_ROUNDS_TOKEN "$(openssl rand -hex 32)"
  echo "    Created the private round token."
else
  echo "    Round token: already set."
fi
for flag in FLOCKENCE_CAMERA_VISION FLOCKENCE_LIVE_CAMERA_VISION; do
  if [[ $(has $flag) == yes ]]; then echo "    $flag: set."
  elif [[ $cameras_on == yes ]]; then add_setting "$flag" on; echo "    $flag: switched on."
  else echo "    $flag: not set. Camera inspections stay off until it is (run again with --cameras-on)."; fi
done
echo "    OPENAI_API_KEY (needed for the analysis): $(has OPENAI_API_KEY)"
echo "    Oriya link for WhatsApp messages (ORIYA_URL, ORIYA_CAMERAS): $(has ORIYA_URL), $(has ORIYA_CAMERAS)"

if [[ $changed == yes ]]; then
  chown --reference="$backup" "$envfile"
  say "Restarting Flockence to load the new settings (backup of .env: $backup)"
  systemctl restart "$service"
  for _ in $(seq 1 60); do curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:3002/login" && break; sleep 2; done
fi

say "Installing the 10-minute timer"
install -m 644 "$src/flockence-vision-rounds.service" /etc/systemd/system/flockence-vision-rounds.service
install -m 644 "$src/flockence-vision-rounds.timer" /etc/systemd/system/flockence-vision-rounds.timer
systemctl daemon-reload
systemctl enable --now flockence-vision-rounds.timer >/dev/null

say "Running one round now"
systemctl start flockence-vision-rounds.service || true
journalctl -u flockence-vision-rounds.service -n 8 --no-pager -o cat || true
say "Done. Choose cameras and timing on https://flockence.com/vision under Automatic inspections."
echo "    Stop the timer any time: sudo systemctl disable --now flockence-vision-rounds.timer"
