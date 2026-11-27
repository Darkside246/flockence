#!/usr/bin/env node
// One automatic camera vision round: asks the running Flockence (on this machine) to inspect the cameras that are due.
// Run by flockence-vision-rounds.timer every 10 minutes (ops/systemd). Reads VISION_ROUNDS_TOKEN from the app's
// settings; prints a short summary and never a secret.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const env = { ...process.env };
for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  try { for (const [k, v] of Object.entries(parseEnv(readFileSync(name, "utf8")))) if (env[k] === undefined) env[k] = v; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const token = env.VISION_ROUNDS_TOKEN ?? "";
if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
  console.error("VISION_ROUNDS_TOKEN is not set. Run ops/systemd/enable-vision-rounds.sh.");
  process.exit(2);
}
const url = env.VISION_ROUNDS_URL || `http://127.0.0.1:${env.PORT || "3002"}/api/internal/vision-rounds`;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
  console.error("VISION_ROUNDS_URL must point at this machine.");
  process.exit(2);
}
try {
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(14 * 60_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`Round refused (${response.status}): ${body?.error ?? "no reason given"}`);
    process.exit(1);
  }
  for (const r of body?.results ?? []) {
    const what = r.error ? `error: ${r.error}` : r.skipped ? `skipped (${r.skipped})` : `${r.ran?.length ?? 0} camera(s) inspected${r.pruned ? `, ${r.pruned} old picture(s) removed` : ""}`;
    console.log(`farm ${r.farmId}: ${what}`);
  }
  if (!body?.results?.length) console.log("No farm has automatic inspections switched on.");
  for (const r of body?.dailyReports ?? []) console.log(`farm ${r.farmId}: daily report ${r.skipped ? `not sent (${r.skipped})` : `sent to ${r.sent}`}${r.failed ? `, ${r.failed} failed (will retry)` : ""}`);
} catch (error) {
  console.error(`Could not reach Flockence at ${url}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
