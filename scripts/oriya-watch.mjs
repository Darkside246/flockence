#!/usr/bin/env node
// Keeps Oriya up to date automatically (docs/ORIYA_LINK.md, 2026-11-02). Leave it running in its own window:
//
//   node scripts/oriya-watch.mjs
//
// Once a minute it asks this machine's Flockence to do an "auto" run. Flockence decides: the farm numbers and
// thermometers every 10 minutes; a Live View of the cameras at dawn every 15 minutes, in the midday heat every 30,
// otherwise hourly, sooner when Oriya asks, never more than ORIYA_DAILY_LIVE_VIEWS times a day (battery). Ctrl+C stops it.
// On a server, cron can do the same:  * * * * *  cd /opt/flockence && node scripts/oriya-push.mjs auto
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
  } catch { return ""; }
}

const token = env("ORIYA_PUSH_TOKEN");
const base = env("FLOCKENCE_LOCAL_URL") || "http://127.0.0.1:3000";
const house = env("ORIYA_HOUSE") || "Main";
if (!token) { console.error("ORIYA_PUSH_TOKEN is not set."); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error("FLOCKENCE_LOCAL_URL must be this machine (http://127.0.0.1:PORT)."); process.exit(2); }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const time = () => new Date().toLocaleTimeString();
console.log(`${time()} Watching: asking Flockence at ${base} once a minute. Ctrl+C to stop.`);

for (;;) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}/api/integrations/oriya/push?pictures=auto&house=${encodeURIComponent(house)}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) console.log(`${time()} Flockence refused the push token (restart Flockence after editing .env).`);
    else if (body.error) console.log(`${time()} ${body.error}`);
    else if (body.skipped) { /* nothing due this minute */ }
    else {
      const pictures = Array.isArray(body.snapshots) ? body.snapshots.map((s) => `${s.camera}: ${s.status}${s.comparedWithEarlier ? " (compared)" : ""}${s.alerts ? `, ${s.alerts} alert(s)` : ""}`).join("; ") : "";
      console.log(`${time()} numbers: ${body.check?.status ?? "-"} ${body.check?.reason ?? ""}${body.check?.alerts ? `, ${body.check.alerts} alert(s)` : ""}` +
        `${pictures ? ` | pictures: ${pictures}` : ""} | live views today: ${body.liveViewsToday ?? "-"}${body.nextCheckMinutes ? ` | Oriya asks for a look in ${body.nextCheckMinutes} min` : ""}`);
    }
  } catch {
    console.log(`${time()} Flockence is not answering at ${base}; trying again in a minute.`);
  }
  await wait(Math.max(5_000, 60_000 - (Date.now() - started)));
}
