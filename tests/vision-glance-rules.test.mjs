import test from "node:test";
import assert from "node:assert/strict";
import { gridTotal, cameraFactor, penEstimate, birdsLine, glance, birdsFromNotes } from "../lib/vision-glance-rules.mjs";

test("the grid count: nine cells added up, or nothing when the grid is broken", () => {
  assert.equal(gridTotal([10, 12, 9, 11, 14, 10, 8, 9, 7]), 90);
  assert.equal(gridTotal([1, 2, 3]), null);
  assert.equal(gridTotal([1, 2, 3, 4, 5, 6, 7, 8, -1]), null);
  assert.equal(gridTotal(null), null);
});

test("each camera learns how much it misses from the farm's real counts", () => {
  assert.equal(cameraFactor([{ counted: 80, actual: 96 }]), null, "one count is not enough");
  assert.equal(cameraFactor([{ counted: 80, actual: 96 }, { counted: 85, actual: 95 }]), 1.16);
  assert.equal(cameraFactor([{ counted: 80, actual: 96 }, { counted: 85, actual: 95 }, { counted: 40, actual: 300 }]), 1.2, "the middle value, so one odd answer does not swing it");
  assert.equal(cameraFactor([{ counted: 100, actual: 90 }, { counted: 100, actual: 95 }]), 1, "never scaled down below what was seen");
  assert.equal(cameraFactor([{ counted: 10, actual: 90 }, { counted: 10, actual: 95 }]), 2, "capped at double");
  assert.deepEqual(penEstimate(80, [{ counted: 80, actual: 96 }, { counted: 85, actual: 95 }]), { estimate: 93, factor: 1.16, samples: 2, shows: 86 });
  assert.equal(penEstimate(80, []), null);
});

test("the birds line puts the count in view beside the pen estimate and the records", () => {
  const est = penEstimate(80, [{ counted: 80, actual: 96 }, { counted: 85, actual: 95 }]);
  const line = birdsLine({ visible: 80, confidence: "LOW", estimate: est, recorded: 96, still: 0 });
  assert.equal(line.level, "OK");
  assert.equal(line.text, "about 80 in view (low confidence) · about 93 in the pen (this camera usually shows 86% of the birds, from 2 of your counts) · 96 in your records · none lying still");
  const down = birdsLine({ visible: 80, still: 2 });
  assert.equal(down.level, "URGENT");
  assert.match(down.text, /2 possible dead or down birds: check now/);
});

test("at a glance: one line per area, worst sign first, short to read; what was not seen is said", () => {
  const g = glance({
    status: "ATTENTION",
    summary: "The pen looks broadly active and spread across dry shavings with several feeders and fans in view, and no clearly still birds were found; loose cords overhead need checking.",
    checks: ["Walk the pen and confirm that the cords overhead are secured.", "Check feed level in each feeder.", "Confirm the drinker lines are flowing.", "Check the fans are running."],
    signals: [
      { category: "BEHAVIOR", state: "NORMAL", evidence: "Birds standing and moving across the floor" },
      { category: "DISTRIBUTION", state: "NORMAL", evidence: "Spread evenly" },
      { category: "LITTER", state: "NORMAL", evidence: "Dry, loose wood shavings" },
      { category: "EQUIPMENT", state: "ATTENTION", evidence: "Red and white cords hang across the top of the pen within reach of birds" },
      { category: "FEED_WATER", state: "NOT_OBSERVED" },
    ],
  }, { visible: 80, confidence: "LOW", recorded: 96 });
  assert.equal(g.rows[0].area, "Birds");
  const by = Object.fromEntries(g.rows.map((r) => [r.area, r]));
  assert.equal(by["Behaviour and spread"].level, "OK");
  assert.equal(by.Litter.text, "Dry, loose wood shavings");
  assert.equal(by.Equipment.level, "CHECK");
  assert.equal(by["Feed and water"].level, "NOT_SEEN");
  assert.equal(by["Heat and air"].text, "not seen in this picture");
  assert.equal(g.todo.length, 3, "the top three things to do");
  assert.ok(g.headline.length <= 110 && g.headline.endsWith("…"), "the headline is kept short");
  assert.deepEqual(g.notSeen, ["Visible health", "Feed and water", "Heat and air"]);
});

test("older reports: the count is read from the saved text", () => {
  assert.deepEqual(birdsFromNotes("Summary: x\n\nBirds visible: about 80 (low confidence). Birds overlap."), { visible: 80, confidence: "LOW" });
  assert.deepEqual(birdsFromNotes("nothing"), { visible: null, confidence: null });
});
