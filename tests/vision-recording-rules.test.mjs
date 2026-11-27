import test from "node:test";
import assert from "node:assert/strict";
import { partOf, pickRecordingChecks, markChecked, missingParts, RECORDINGS_PER_ROUND } from "../lib/vision-recording-rules.mjs";

// The tests use UTC hours as the farm's hours.
const hourOf = (d) => d.getUTCHours();
const now = new Date("2026-11-27T20:00:00Z");
const clip = (id, iso, camera = "Pen 1 cam") => ({ id, camera, createdAt: iso, source: "blink", media: `/api/v1/clips/${id}` });

test("parts of the day", () => {
  assert.deepEqual([0, 4, 5, 10, 11, 14, 15, 18, 19, 23].map(partOf), ["night", "night", "morning", "morning", "midday", "midday", "afternoon", "afternoon", "evening", "evening"]);
});

test("one clip per camera per part of the day, nearest the middle of it, oldest part first", () => {
  const clips = [
    clip("m1", "2026-11-27T05:30:00Z"), clip("m2", "2026-11-27T08:10:00Z"),   // morning: 08:10 is nearer the middle (08:00)
    clip("d1", "2026-11-27T13:00:00Z"),                                        // midday
    clip("old", "2026-11-26T08:00:00Z"),                                       // more than 24 hours ago
    clip("future", "2026-11-27T21:00:00Z"),
    clip("x1", "2026-11-27T09:00:00Z", "Other cam"),
  ];
  const picks = pickRecordingChecks(clips, null, now, hourOf, 5, ["Pen 1 cam"]);
  assert.deepEqual(picks.map((p) => [p.clip.id, p.part]), [["m2", "morning"], ["d1", "midday"]]);
  assert.equal(RECORDINGS_PER_ROUND, 2);
  assert.equal(pickRecordingChecks(clips, null, now, hourOf).length, 2, "at most 2 a round by default");
});

test("a checked part is not checked again within 24 hours, and checked clips are remembered", () => {
  const clips = [clip("m2", "2026-11-27T08:10:00Z"), clip("m3", "2026-11-27T09:00:00Z"), clip("d1", "2026-11-27T13:00:00Z")];
  const first = pickRecordingChecks(clips, null, now, hourOf, 1);
  assert.equal(first[0].clip.id, "m2");
  const state = markChecked(null, first[0], now);
  assert.deepEqual(pickRecordingChecks(clips, state, now, hourOf, 5).map((p) => p.clip.id), ["d1"], "the morning is done; m3 is not checked too");
});

test("old marks are forgotten after two days", () => {
  const state = markChecked({ done: { gone: "2026-11-20T08:00:00Z" }, covered: { "a|morning": "2026-11-20T08:00:00Z" } }, { clip: clip("m2", "2026-11-27T08:10:00Z"), camera: "Pen 1 cam", part: "morning" }, now);
  assert.deepEqual(Object.keys(state.done), ["m2"]);
  assert.deepEqual(Object.keys(state.covered), ["Pen 1 cam|morning"]);
});

test("parts of the day with no recording are listed per camera", () => {
  const clips = [clip("m2", "2026-11-27T08:10:00Z"), clip("d1", "2026-11-27T13:00:00Z")];
  assert.deepEqual(missingParts(clips, ["Pen 1 cam", "Silent cam"], now, hourOf), {
    "Pen 1 cam": ["night", "afternoon", "evening"],
    "Silent cam": ["night", "morning", "midday", "afternoon", "evening"],
  });
});
