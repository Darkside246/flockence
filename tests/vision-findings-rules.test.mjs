import test from "node:test";
import assert from "node:assert/strict";
import { findingsFromAnalysis, incidentKey, joinsIncident, reviewFinding } from "../lib/vision-findings-rules.mjs";

test("still birds become a 'needs a look' finding; three or more are urgent", () => {
  const one = findingsFromAnalysis({ stillBirds: [{ where: "near the left drinker", why: "on its side", confidence: "MEDIUM" }] });
  assert.equal(one.length, 1);
  assert.equal(one[0].kind, "DEAD_OR_DOWN_BIRD");
  assert.equal(one[0].severity, "HIGH");
  assert.equal(one[0].state, "REQUIRES_INSPECTION");
  assert.match(one[0].title, /near the left drinker/);
  const three = findingsFromAnalysis({ stillBirds: [{ where: "a" }, { where: "b" }, { where: "c" }] });
  assert.equal(three[0].severity, "CRITICAL");
});

test("signals map to findings, one per kind with the worst severity; normal and unseen ones make none", () => {
  const out = findingsFromAnalysis({ confidence: "LOW", signals: [
    { category: "LITTER", state: "ATTENTION", evidence: "dark patch under drinker line" },
    { category: "COMFORT", state: "WARNING", evidence: "many birds panting" },
    { category: "BEHAVIOR", state: "ATTENTION", evidence: "birds bunched in one corner" },
    { category: "DISTRIBUTION", state: "CRITICAL", evidence: "piling against the wall" },
    { category: "EQUIPMENT", state: "NORMAL", evidence: "fans running" },
    { category: "FEED_WATER", state: "NOT_OBSERVED" },
  ] });
  const by = Object.fromEntries(out.map((f) => [f.kind, f]));
  assert.deepEqual(Object.keys(by).sort(), ["BEHAVIOUR", "LITTER", "THERMAL"]);
  assert.equal(by.THERMAL.severity, "HIGH");
  assert.equal(by.BEHAVIOUR.severity, "CRITICAL");
  assert.match(by.BEHAVIOUR.detail, /bunched.*piling/);
  assert.equal(by.LITTER.state, "SUSPECTED");
});

test("bird numbers: fewer in view than recorded is normal (partial view); clearly more is a finding, never a change", () => {
  assert.equal(findingsFromAnalysis({ birdCount: { visible: 108 } }, { expectedLive: 116 }).length, 0);
  const more = findingsFromAnalysis({ birdCount: { visible: 130, confidence: "LOW" } }, { expectedLive: 116 });
  assert.equal(more[0].kind, "POPULATION");
  assert.match(more[0].detail, /official count is not changed/);
  assert.equal(findingsFromAnalysis({ birdCount: { visible: 118 } }, { expectedLive: 116 }).length, 0, "within counting error");
  assert.equal(findingsFromAnalysis({ birdCount: { visible: 130 } }, { expectedLive: null }).length, 0);
});

test("repeat sightings join an open incident in the same pen within 48 hours", () => {
  assert.equal(incidentKey("LITTER", { penId: "p1", cameraName: "Cam" }), "LITTER|pen:p1");
  assert.equal(incidentKey("LITTER", { cameraName: "Cam" }), "LITTER|cam:Cam");
  const now = new Date("2026-11-27T12:00:00Z");
  assert.equal(joinsIncident({ state: "SUSPECTED", lastSeenAt: "2026-11-26T13:00:00Z" }, now), true);
  assert.equal(joinsIncident({ state: "SUSPECTED", lastSeenAt: "2026-11-25T11:00:00Z" }, now), false);
  assert.equal(joinsIncident({ state: "RESOLVED", lastSeenAt: "2026-11-27T11:00:00Z" }, now), false, "a fixed problem seen again is a new incident");
});

test("a review records who, when and why, and keeps the original", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  const r = reviewFinding({ state: "REQUIRES_INSPECTION" }, { state: "DISMISSED", note: " bird was resting " }, "Owner", now);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entry, { at: now.toISOString(), from: "REQUIRES_INSPECTION", to: "DISMISSED", by: "Owner", note: "bird was resting" });
  assert.equal(reviewFinding({ state: "SUSPECTED" }, { state: "DELETED" }, "x", now).ok, false);
  assert.equal(reviewFinding({ state: "CONFIRMED" }, { state: "CONFIRMED" }, "x", now).ok, false);
});
