import test from "node:test";
import assert from "node:assert/strict";
import { accuracyReport, cleanLabel, evaluationCsv, modelSaid, parseSavedLabel } from "../lib/vision-accuracy-rules.mjs";

test("vision accuracy: labels are whole numbers or empty; nonsense is refused", () => {
  assert.deepEqual(cleanLabel({ birds: "40", deadOrDown: 0, floorEggs: "" }), { birds: 40, deadOrDown: 0, floorEggs: null });
  assert.equal(cleanLabel({ birds: "", deadOrDown: null }), null, "all empty clears the label");
  assert.equal(cleanLabel({ birds: "4.5" }), undefined);
  assert.equal(cleanLabel({ birds: -1 }), undefined);
  assert.equal(cleanLabel({ deadOrDown: 9999 }), undefined);
  assert.deepEqual(parseSavedLabel(JSON.stringify({ birds: 3, deadOrDown: 1, floorEggs: null, by: "u1", at: "2026-11-28T10:00:00Z" })), { birds: 3, deadOrDown: 1, floorEggs: null, by: "u1", at: "2026-11-28T10:00:00Z" });
  assert.equal(parseSavedLabel("{bad"), null);
});

test("vision accuracy: what the model said comes from the record, or from older notes", () => {
  assert.deepEqual(modelSaid({ seen: { birds: 41, stillBirds: 2 }, detector: { count: 39 }, eggs: { floorEggs: 3 } }, ""), { birds: 41, stillBirds: 2, detector: 39, floorEggs: 3 });
  const notes = "Summary: fine\n\nBirds visible: about 52 (medium confidence)\n\nBirds lying still (check whether they are dead or unable to move):\n- by the drinker\n- near the wall\n\nNot in view: back corner";
  assert.deepEqual(modelSaid({}, notes), { birds: 52, stillBirds: 2, detector: null, floorEggs: null });
  assert.deepEqual(modelSaid(null, "Summary only"), { birds: null, stillBirds: 0, detector: null, floorEggs: null });
});

test("vision accuracy: count misses, dead birds found and missed, false alarms", () => {
  const rows = [
    { label: { birds: 50, deadOrDown: 1, floorEggs: null }, said: { birds: 45, stillBirds: 1, detector: 49, floorEggs: null } },
    { label: { birds: 40, deadOrDown: 0, floorEggs: null }, said: { birds: 44, stillBirds: 1, detector: 40, floorEggs: null } },
    { label: { birds: 30, deadOrDown: 2, floorEggs: 4 }, said: { birds: 30, stillBirds: 0, detector: null, floorEggs: 2 } },
    { label: { birds: null, deadOrDown: 0, floorEggs: null }, said: { birds: 10, stillBirds: 0, detector: null, floorEggs: null } },
    { label: null, said: { birds: 12, stillBirds: 0, detector: null, floorEggs: null } },
  ];
  const r = accuracyReport(rows, { confirmed: 3, dismissed: 1 });
  assert.equal(r.labelled, 4);
  assert.equal(r.checks, 5);
  assert.equal(r.dependable, false);
  assert.deepEqual(r.birdCount.model, { checks: 3, meanMiss: 3, meanMissPercent: 6.7, within10Percent: 100 });
  assert.deepEqual(r.birdCount.counter, { checks: 2, meanMiss: 0.5, meanMissPercent: 1, within10Percent: 100 });
  assert.deepEqual(r.deadBirds, { checks: 4, found: 1, missed: 1, falseAlarms: 1, quiet: 1, foundPercent: 50, falseAlarmPercent: 50 });
  assert.deepEqual(r.floorEggs, { checks: 1, meanMiss: 2, meanMissPercent: 50, within10Percent: 0 });
  assert.deepEqual(r.reviewedFindings, { confirmed: 3, dismissed: 1, rightPercent: 75 });
});

test("vision accuracy: nothing labelled reports nothing, not zero", () => {
  const r = accuracyReport([{ label: null, said: { birds: 3, stillBirds: 0, detector: null, floorEggs: null } }]);
  assert.equal(r.birdCount.model, null);
  assert.equal(r.deadBirds.foundPercent, null);
  assert.equal(r.reviewedFindings.rightPercent, null);
});

test("vision accuracy: the evaluation CSV has one row per labelled picture and is safe in a spreadsheet", () => {
  const csv = evaluationCsv([
    { id: "o1", observedAt: "2026-11-28T10:00:00.000Z", camera: "=HYPERLINK(1)", pen: "Pen, A", imageUrl: "/api/vision/media/m1", label: { birds: 5, deadOrDown: 0, floorEggs: null }, said: { birds: 6, stillBirds: 0, detector: null, floorEggs: null } },
    { id: "o2", observedAt: "2026-11-28T11:00:00.000Z", camera: null, pen: null, imageUrl: null, label: null, said: { birds: 1, stillBirds: 0, detector: null, floorEggs: null } },
  ]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^o1,2026-11-28T10:00:00.000Z,"'=HYPERLINK\(1\)","Pen, A",\/api\/vision\/media\/m1,5,0,,6,0,,$/);
});
