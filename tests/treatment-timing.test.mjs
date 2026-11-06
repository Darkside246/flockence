import test from "node:test";
import assert from "node:assert/strict";
import { withdrawalClearsAt } from "../lib/treatment-timing.ts";

const d = (s) => new Date(s + "T00:00:00.000Z");
const day = (x) => x?.toISOString().slice(0, 10) ?? null;

test("a single dose clears withdrawal days after the dose", () => {
  assert.equal(day(withdrawalClearsAt(d("2026-11-01"), null, null, 7)), "2026-11-08");
});

test("a course counts from its end: 5 days of treatment plus 7 days withdrawal clears 12 days after the start", () => {
  assert.equal(day(withdrawalClearsAt(d("2026-11-01"), null, 5, 7)), "2026-11-13");
});

test("a recorded end date wins over the planned course length", () => {
  assert.equal(day(withdrawalClearsAt(d("2026-11-01"), d("2026-11-04"), 5, 7)), "2026-11-11");
});

test("no withdrawal means no clearance date", () => {
  assert.equal(withdrawalClearsAt(d("2026-11-01"), null, 5, 0), null);
  assert.equal(withdrawalClearsAt(d("2026-11-01"), null, 5, Number.NaN), null);
});
