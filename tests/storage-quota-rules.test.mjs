import test from "node:test";
import assert from "node:assert/strict";
import { bytesToFree, formatBytes, GB, storageLimitBytes, storageStatus } from "../lib/storage-quota-rules.mjs";
import { visionPlan } from "../lib/vision-schedule-rules.mjs";

test("storage per plan: Free 1 GB, Standard 10 GB, Premium 50 GB, with a server override", () => {
  assert.equal(storageLimitBytes("FREE"), 1 * GB);
  assert.equal(storageLimitBytes("STANDARD"), 10 * GB);
  assert.equal(storageLimitBytes("PREMIUM"), 50 * GB);
  assert.equal(storageLimitBytes("UNKNOWN"), 1 * GB, "anything unknown gets the Free size");
  assert.equal(storageLimitBytes("FREE", '{"FREE":0.5}'), 0.5 * GB);
  assert.equal(storageLimitBytes("FREE", "not json"), 1 * GB);
  assert.equal(storageLimitBytes("FREE", '{"FREE":-3}'), 1 * GB);
});

test("warn from 80%, full at 100%", () => {
  assert.deepEqual(storageStatus(0.5 * GB, GB), { used: 0.5 * GB, limit: GB, percent: 50, level: "ok" });
  assert.equal(storageStatus(0.8 * GB, GB).level, "warn");
  assert.equal(storageStatus(GB, GB).level, "full");
  assert.equal(storageStatus(2 * GB, GB).percent, 100);
});

test("room is made down to 95% of the limit, only when the next picture does not fit", () => {
  assert.equal(bytesToFree(0.5 * GB, 1_000_000, GB), 0);
  assert.equal(bytesToFree(GB - 1_000_000, 1_000_000, GB), 0, "exactly fits");
  assert.equal(bytesToFree(GB, 1_000_000, GB), 0.05 * GB + 1_000_000);
});

test("sizes read plainly", () => {
  assert.equal(formatBytes(1_500_000_000), "1.5 GB");
  assert.equal(formatBytes(250_000_000), "250 MB");
});

test("Oriya's Standard plan gets Standard limits", () => {
  assert.equal(visionPlan("STANDARD", "farm-x"), "STANDARD");
  assert.equal(visionPlan("EXISTING", "farm-x"), "STANDARD");
  assert.equal(visionPlan("FREE", "farm-x"), "FREE");
  assert.equal(visionPlan("PREMIUM", "farm-x"), "PREMIUM");
});
