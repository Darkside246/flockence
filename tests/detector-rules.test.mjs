import test from "node:test";
import assert from "node:assert/strict";
import { iou, confident, stillBirds, whereInPicture, summariseDetections } from "../lib/detector-rules.mjs";

test("box overlap", () => {
  assert.equal(iou([0, 0, 1, 1], [0, 0, 1, 1]), 1);
  assert.equal(iou([0, 0, 0.5, 0.5], [0.5, 0.5, 1, 1]), 0);
  assert.ok(Math.abs(iou([0, 0, 0.2, 0.2], [0.1, 0, 0.3, 0.2]) - 1 / 3) < 1e-9);
});

test("low-confidence and broken boxes are ignored", () => {
  assert.equal(confident([[0, 0, 0.1, 0.1, 0.9], [0, 0, 0.1, 0.1, 0.1], [0.2, 0.2, 0.1, 0.3, 0.9], "x"]).length, 1);
});

const bird = (x, y, s = 0.9) => [x, y, x + 0.05, y + 0.05, s];

test("a bird that stays put while others move is a still bird", () => {
  const frames = [
    [bird(0.1, 0.8), bird(0.5, 0.5), bird(0.7, 0.2)],
    [bird(0.1, 0.8), bird(0.55, 0.45), bird(0.75, 0.3)],
    [bird(0.1, 0.8), bird(0.6, 0.4), bird(0.8, 0.35)],
  ];
  const still = stillBirds(frames);
  assert.equal(still.length, 1);
  assert.equal(whereInPicture(still[0]), "lower left");
});

test("when nothing moved (all resting, or the same picture), stillness proves nothing", () => {
  const same = [bird(0.1, 0.8), bird(0.5, 0.5)];
  assert.deepEqual(stillBirds([same, same, same]), []);
  assert.deepEqual(stillBirds([same]), [], "one frame cannot show stillness");
});

test("the summary: the count in the clearest frame, and where the still birds are", () => {
  const s = summariseDetections([[bird(0.1, 0.8), bird(0.5, 0.5)], [bird(0.1, 0.8), bird(0.6, 0.4), bird(0.2, 0.2)]], "birds-v1");
  assert.equal(s.count, 3);
  assert.deepEqual(s.counts, [2, 3]);
  assert.equal(s.still.length, 1);
  assert.equal(s.still[0].where, "lower left");
  assert.equal(s.model, "birds-v1");
});
