import test from "node:test";
import assert from "node:assert/strict";
import { buildFarmRows, formatUsd, platformTotals, readVisionMonth } from "../lib/platform-overview-rules.mjs";

const now = new Date("2026-11-28T12:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000);
const facts = () => ({
  users: new Map([["a", { total: 3, owners: [{ name: "Ann", email: "ann@a.test" }] }], ["b", { total: 1, owners: [] }]]),
  activeFlocks: new Map([["a", 2]]),
  lastActivity: new Map([["a", daysAgo(1)], ["b", daysAgo(20)]]),
  storageBytes: new Map([["a", 5_000_000]]),
  visionMonth: new Map([["a", { checks: 4, costMicros: 12_345 }]]),
  deletionPending: new Set(["c"]),
});
const farms = [
  { id: "a", name: "Alpha", createdAt: daysAgo(30) },
  { id: "b", name: "Bravo", createdAt: daysAgo(30) },
  { id: "c", name: "Charlie", createdAt: daysAgo(2) },
];

test("platform console: farms needing a look come first, with plain reasons", () => {
  const rows = buildFarmRows(farms, facts(), now);
  assert.deepEqual(rows.map((r) => r.id), ["b", "c", "a"]);
  assert.deepEqual(rows[0].flags, ["No owner", "Quiet 20 days"]);
  assert.deepEqual(rows[1].flags, ["Deletion pending", "No owner", "No activity yet"]);
  assert.deepEqual(rows[2].flags, []);
  assert.equal(rows[2].activeFlocks, 2);
  assert.equal(rows[2].visionChecks, 4);
  assert.equal(rows[1].members, 0);
});

test("platform console: totals add up across farms", () => {
  const t = platformTotals(buildFarmRows(farms, facts(), now));
  assert.deepEqual(t, { farms: 3, members: 4, activeFlocks: 2, storageBytes: 5_000_000, visionChecks: 4, visionCostMicros: 12_345, needAttention: 2 });
});

test("platform console: vision usage and cost read safely", () => {
  assert.deepEqual(readVisionMonth(JSON.stringify({ manual: 2, automatic: 3, costMicros: 1_500_000 })), { checks: 5, costMicros: 1_500_000 });
  assert.deepEqual(readVisionMonth("not json"), { checks: 0, costMicros: 0 });
  assert.deepEqual(readVisionMonth(null), { checks: 0, costMicros: 0 });
  assert.equal(formatUsd(1_500_000), "US$1.50");
  assert.equal(formatUsd(0), "US$0.00");
});
