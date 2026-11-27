import test from "node:test";
import assert from "node:assert/strict";
import { areaStatuses, overallStatus, rankedActions, summarise } from "../lib/vision-report-rules.mjs";

test("with no inspections, every area and the whole report are 'insufficient data', never 'good'", () => {
  const areas = areaStatuses([], []);
  assert.ok(Object.values(areas).every((a) => a.status === "INSUFFICIENT_DATA"));
  assert.equal(overallStatus(areas), "INSUFFICIENT_DATA");
  assert.match(summarise({ scopeLabel: "Pen 1", periodLabel: "today", overall: "INSUFFICIENT_DATA", actions: [], inspections: 0, cameras: 0, hoursCovered: 0, hoursInPeriod: 24 }), /cannot say how the birds are/);
});

test("areas seen with nothing wrong are good; areas not seen stay insufficient; no view of the birds means no 'good' overall", () => {
  const seenLitterOnly = areaStatuses([], [{ signals: [{ category: "LITTER", state: "NORMAL" }] }]);
  assert.equal(seenLitterOnly.LITTER.status, "GOOD");
  assert.equal(seenLitterOnly.BIRDS.status, "INSUFFICIENT_DATA");
  assert.equal(overallStatus(seenLitterOnly), "INSUFFICIENT_DATA");
  const seenBirds = areaStatuses([], [{ signals: [{ category: "BEHAVIOR", state: "NORMAL" }], visibleBirds: 80 }]);
  assert.equal(overallStatus(seenBirds), "GOOD");
});

test("one serious problem decides the overall status; dismissed findings do not count; fixed ones are noted", () => {
  const inspections = [{ signals: [{ category: "BEHAVIOR", state: "NORMAL" }, { category: "LITTER", state: "NORMAL" }] }];
  const areas = areaStatuses([
    { kind: "DEAD_OR_DOWN_BIRD", severity: "HIGH", state: "REQUIRES_INSPECTION", title: "Possible dead or down bird by the wall", occurrences: 3 },
    { kind: "LITTER", severity: "MEDIUM", state: "DISMISSED", title: "Litter" },
    { kind: "THERMAL", severity: "MEDIUM", state: "RESOLVED", title: "Heat or cold behaviour" },
  ], inspections);
  assert.equal(areas.BIRDS.status, "ATTENTION");
  assert.match(areas.BIRDS.reasons[0], /seen 3 times/);
  assert.equal(areas.LITTER.status, "GOOD");
  assert.equal(areas.THERMAL.fixed, 1);
  assert.equal(overallStatus(areas), "ATTENTION");
});

test("actions: most serious first, one per kind, closed findings left out", () => {
  const actions = rankedActions([
    { kind: "LITTER", severity: "MEDIUM", state: "SUSPECTED", title: "Litter", lastSeenAt: "2026-11-27T10:00:00Z" },
    { kind: "DEAD_OR_DOWN_BIRD", severity: "CRITICAL", state: "REQUIRES_INSPECTION", title: "3 possible dead or down birds", lastSeenAt: "2026-11-27T09:00:00Z" },
    { kind: "LITTER", severity: "HIGH", state: "SUSPECTED", title: "Litter", lastSeenAt: "2026-11-27T11:00:00Z" },
    { kind: "EQUIPMENT", severity: "HIGH", state: "RESOLVED", title: "Equipment" },
  ]);
  assert.deepEqual(actions.map((a) => a.kind), ["DEAD_OR_DOWN_BIRD", "LITTER"]);
  assert.match(actions[0].action, /record it in Daily Rounds/);
});
