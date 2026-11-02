#!/usr/bin/env node
// Flock check for Oriya (docs/ORIYA_LINK.md): none | thumbnail | fresh | auto. Run by cron on the Flockence server, e.g.:
//   * * * * *     cd /opt/flockence && node scripts/oriya-push.mjs auto      (the schedule; or scripts/oriya-watch.mjs)
//   */10 * * * *  cd /opt/flockence && node scripts/oriya-push.mjs thumbnail
//   7 * * * *     cd /opt/flockence && node scripts/oriya-push.mjs fresh
// It calls this app's own /api/integrations/oriya/push on this machine with ORIYA_PUSH_TOKEN; it prints counts only.
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
  } catch { return ""; }
}

const pictures = process.argv[2] ?? "thumbnail";
const house = process.argv[3] || env("ORIYA_HOUSE") || "Main";
const token = env("ORIYA_PUSH_TOKEN");
const base = env("FLOCKENCE_LOCAL_URL") || "http://127.0.0.1:3000";
if (!token) { console.error("ORIYA_PUSH_TOKEN is not set."); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error("FLOCKENCE_LOCAL_URL must be this machine (http://127.0.0.1:PORT)."); process.exit(2); }

const url = `${base}/api/integrations/oriya/push?pictures=${encodeURIComponent(pictures)}&house=${encodeURIComponent(house)}`;
console.error(`Asking Flockence at ${base} to send to Oriya...`);
let response;
try {
  response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
} catch {
  console.error(`Flockence is not answering at ${base}. Is it running? Is FLOCKENCE_LOCAL_URL the right port (the Windows start script uses 3001)?`);
  process.exit(1);
}
const body = await response.json().catch(() => ({}));
if (response.status === 401) {
  console.error("Flockence refused the push token. Restart Flockence after editing .env (it reads ORIYA_PUSH_TOKEN when it starts), " +
    "check ORIYA_PUSH_TOKEN is at least 24 characters, and check FLOCKENCE_LOCAL_URL points at Flockence, not another app.");
} else if (body.error === "LINK_NOT_SET_UP") {
  console.error("Flockence's Oriya settings are missing or wrong: ORIYA_URL (https://oriya.si), ORIYA_LINK_KEY_ID (cop_...) and ORIYA_LINK_SECRET (32+ characters). Restart Flockence after fixing them.");
} else if (body.check && typeof body.check.status === "number" && body.check.status !== 201) {
  const byReason = {
    NOT_ORIYA: "The refusal did not come from Oriya. Something in between (usually Cloudflare's bot protection or firewall rules) blocked the request.",
    LINK_OFF: "Oriya says the link is off: CHICKEN_OP_LINK=on must reach the Oriya app, the farm's link must be on (Farm > Poultry), and the farm account must be active (or have Internal access).",
    UNKNOWN_KEY: "Oriya does not know this key id: copy ORIYA_LINK_KEY_ID again from Oriya, exactly, then restart Flockence.",
    BAD_SIGNATURE: "Oriya says the secret does not match: copy ORIYA_LINK_SECRET again from Oriya, exactly, then restart Flockence.",
    TOO_OLD: "Oriya says the request is too old: check this PC's clock and time zone are correct (Windows Settings > Time > Set time automatically).",
    INVALID_EVENT: "Oriya refused the message format: tell Claude.",
  };
  console.error(byReason[body.check.reason] ?? `Oriya refused with status ${body.check.status} (${body.check.reason ?? "no reason"}). Tell Claude.`);
}
const snaps = Array.isArray(body.snapshots) ? body.snapshots : [];
console.log(JSON.stringify({ status: response.status, check: body.check ?? body.error ?? null, pictures: snaps.map((s) => ({ camera: s.camera, status: s.status, alerts: s.alerts })) }));
process.exit(response.ok ? 0 : 1);
