// Warm the Next.js dev server so the first click on each page is not a 3-8 second compile.
// Read-only GET requests to page routes and a fixed list of safe data routes. Dev only.
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const base = process.argv[2] || "http://127.0.0.1:3001";

function pages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "api") pages(p, out); }
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

const pagePaths = pages("app")
  .map((p) => "/" + p.slice(4, -"page.tsx".length).split(sep).join("/").replace(/\/$/, ""))
  .map((p) => (p === "/" ? "/" : p))
  .filter((p) => !/\[|login|signup|forgot|reset/.test(p));

const api = ["dashboard", "lifecycle", "daily-round", "action-queue", "procurement", "weather", "tasks", "batches", "layers/performance",
  "egg-collections", "egg-packs", "storage-locations", "slaughter", "transport-events?limit=30", "expenses", "orders", "pen-config", "inventory",
  "products", "suppliers", "customers", "sales", "settings", "team", "performance/summary", "health/cases", "health/tests", "health/treatments",
  "mortality", "weights", "plans", "reports", "trace", "vision", "withdrawal-status", "cameras/status", "cameras/cameras"].map((p) => "/api/" + p);

const targets = [...new Set([...pagePaths, ...api])];
let done = 0, slow = [];
async function hit(path) {
  const t = Date.now();
  try { await fetch(base + path, { signal: AbortSignal.timeout(60_000) }); } catch { /* route may not exist; compiling is all we need */ }
  const ms = Date.now() - t; if (ms > 2500) slow.push(`${path} ${(ms / 1000).toFixed(1)}s`); done++;
}
const queue = [...targets];
await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await hit(queue.shift()); }));
console.log(`Warmed ${done} routes at ${base}.${slow.length ? " Slowest: " + slow.slice(0, 5).join(", ") : ""}`);
