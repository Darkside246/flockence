import assert from "node:assert/strict";
import test from "node:test";
import { compareVisionAssessments, createVisionAssessment, visionResultSchema } from "../lib/vision-assessment.ts";

const camera = { kind: "CAMERA", name: "Pen camera", provider: "rtsp" };
const metadata = { model: "fixture-model", source: camera, inspectionCategory: "PEN", evidenceId: "image-1" };

test("an unseen area stays unknown and serious evidence overrides missing categories", () => {
  const missing = createVisionAssessment(visionResultSchema.parse({ summary: "Limited view", confidence: "HIGH", severity: "HIGH" }), metadata);
  assert.equal(missing.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(missing.signals.every(({ state }) => state === "NOT_OBSERVED"));
  const urgent = createVisionAssessment(visionResultSchema.parse({
    summary: "One obstruction is visible",
    signals: [
      { category: "EQUIPMENT", state: "NORMAL", evidence: "Most access is visible." },
      { category: "EQUIPMENT", state: "CRITICAL", evidence: "A barrier blocks the only visible exit." },
    ],
  }), metadata);
  assert.equal(urgent.status, "CRITICAL");
  assert.equal(urgent.signals.find(({ category }) => category === "EQUIPMENT").state, "CRITICAL");
  assert.equal(visionResultSchema.safeParse({ summary: "Missing evidence", signals: [{ category: "LITTER", state: "NORMAL" }] }).success, false);
});

test("a matched pair compares only shared visible evidence", () => {
  const row = (id, day, result, overrides = {}) => ({
    id, batchId: "batch", observedAt: new Date("2026-11-" + day + "T12:00:00Z"),
    visionAssessment: createVisionAssessment(visionResultSchema.parse(result), { ...metadata, ...overrides }),
  });
  const a = row("earlier", "24", { summary: "Dry patch in view", signals: [{ category: "LITTER", state: "NORMAL", evidence: "Dry bedding." }] });
  const b = row("later", "25", { summary: "A wet patch", signals: [
    { category: "LITTER", state: "WARNING", evidence: "Wet bedding." },
    { category: "EQUIPMENT", state: "NORMAL", evidence: "The feeder entrance is clear." },
  ] });
  const paired = compareVisionAssessments(b, a);
  assert.equal(paired.earlier.id, a.id);
  assert.deepEqual(paired.changes, [{ category: "LITTER", before: "NORMAL", after: "WARNING", earlierEvidence: "Dry bedding.", laterEvidence: "Wet bedding." }]);
  assert.equal(compareVisionAssessments(a, { ...b, batchId: null }), null);
  assert.equal(compareVisionAssessments(a, { ...b, visionAssessment: { ...b.visionAssessment, model: "other" } }), null);
  assert.equal(compareVisionAssessments(a, { ...b, visionAssessment: { ...b.visionAssessment, source: { ...camera, name: "Other camera" } } }), null);
});
