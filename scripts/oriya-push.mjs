#!/usr/bin/env node
// Scheduled flock check for Oriya (docs/ORIYA_LINK.md). Run by cron on the Flockence server, e.g.:
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
const house = process.argv[3] ?? env("ORIYA_HOUSE") || "Main";
const token = env("ORIYA_PUSH_TOKEN");
const base = env("FLOCKENCE_LOCAL_URL") || "http://127.0.0.1:3000";
if (!token) { console.error("ORIYA_PUSH_TOKEN is not set."); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error("FLOCKENCE_LOCAL_URL must be this machine (http://127.0.0.1:PORT)."); process.exit(2); }

const url = `${base}/api/integrations/oriya/push?pictures=${encodeURIComponent(pictures)}&house=${encodeURIComponent(house)}`;
const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
const body = await response.json().catch(() => ({}));
const snaps = Array.isArray(body.snapshots) ? body.snapshots : [];
console.log(JSON.stringify({ status: response.status, check: body.check ?? body.error ?? null, pictures: snaps.map((s) => ({ camera: s.camera, status: s.status, alerts: s.alerts })) }));
process.exit(response.ok ? 0 : 1);
