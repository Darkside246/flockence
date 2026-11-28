import test from "node:test";
import assert from "node:assert/strict";
import { canDeleteFarm, confirmsFarmName, deletionStatus, GRACE_DAYS, newDeletion, parseDeletion } from "../lib/farm-deletion-rules.mjs";

const now = new Date("2026-11-28T12:00:00Z");

test("a request deletes after the 30-day grace period", () => {
  assert.equal(GRACE_DAYS, 30);
  const d = newDeletion(now, "u1");
  assert.equal(d.deleteAfter, "2026-12-28T12:00:00.000Z");
  assert.deepEqual(deletionStatus(d, now), { pending: true, deleteAfter: d.deleteAfter, daysLeft: 30, due: false });
  assert.equal(deletionStatus(d, new Date("2026-12-28T11:59:00Z")).due, false);
  assert.equal(deletionStatus(d, new Date("2026-12-28T12:00:00Z")).due, true);
  assert.deepEqual(deletionStatus(null, now), { pending: false });
});

test("bad or shortened saved data never means delete", () => {
  assert.equal(parseDeletion(null), null);
  assert.equal(parseDeletion("not json"), null);
  assert.equal(parseDeletion(JSON.stringify({ requestedAt: now.toISOString(), deleteAfter: now.toISOString() })), null, "a grace period cut short is ignored");
  assert.ok(parseDeletion(JSON.stringify(newDeletion(now, "u1"))));
});

test("the typed farm name must match; the home farm can never be deleted", () => {
  assert.equal(confirmsFarmName("  alchemy   farms ", "Alchemy Farms"), true);
  assert.equal(confirmsFarmName("Alchemy", "Alchemy Farms"), false);
  assert.equal(confirmsFarmName("", ""), false);
  assert.equal(canDeleteFarm("default-farm", "default-farm"), false);
  assert.equal(canDeleteFarm("farm-x", "default-farm"), true);
});
