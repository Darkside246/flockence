import test from "node:test";
import assert from "node:assert/strict";
import { penLayoutAdvice, summariseSightings } from "../lib/pen-layout-rules.mjs";

const pen = { lengthM: 10, widthM: 12, housingMode: "OPEN_SIDED_HOT", feederPans: 8, nipples: 60, bellDrinkers: 0, heatSources: 2, fans: 1 };
const noneSeen = summariseSightings([]);

test("density from the records against the housing ceiling, with how many birds to move", () => {
  const a = penLayoutAdvice({ pen, live: 1000, weightKg: 2.5, seen: noneSeen });
  assert.equal(a.areaM2, 120);
  assert.equal(a.densityKgM2, 20.8);
  assert.equal(a.ceilingKgM2, 18);
  const top = a.recommendations[0];
  assert.equal(top.priority, 1);
  assert.match(top.text, /above the 18 kg\/m² ceiling for open-sided, hot housing\. Move about 136 birds/);
  assert.match(top.basis, /Ross/);
});

test("no size recorded: says so instead of guessing from pictures", () => {
  const a = penLayoutAdvice({ pen: { ...pen, lengthM: 0 }, live: 500, weightKg: 1, seen: noneSeen });
  assert.equal(a.areaM2, null);
  assert.match(a.recommendations[0].text, /Vision cannot measure a pen from pictures/);
});

test("no weight recorded: no density, and asks for a weigh-in", () => {
  const a = penLayoutAdvice({ pen, live: 500, weightKg: null, seen: noneSeen });
  assert.equal(a.densityKgM2, null);
  assert.ok(a.notes.some((n) => /Record a weigh-in/.test(n)));
});

test("feeders and drinkers against bird numbers, citing the guides", () => {
  const a = penLayoutAdvice({ pen: { ...pen, feederPans: 10, nipples: 50 }, live: 900, weightKg: 1.2, seen: noneSeen });
  const feed = a.recommendations.find((r) => /feeder pan/.test(r.text));
  assert.match(feed.text, /Add about 4 feeder pans: 10 recorded for 900 birds, and 14–20 are needed/);
  assert.match(feed.basis, /Cobb/);
  const water = a.recommendations.find((r) => /drinking space/.test(r.text));
  assert.match(water.text, /about 300 more birds: about 25 more nipples, or 4 more bell drinkers/);
});

test("what the cameras saw fills in missing records and is checked against them", () => {
  const seen = summariseSightings([
    { layout: { view: "WHOLE_PEN", feeders: 6, heaters: 1, crowding: [{ at: "HEATER" }] } },
    { layout: { view: "PART_OF_PEN", feeders: 2, crowding: [{ at: "HEATER" }, { at: "HEATER" }] } },
    { layout: { view: "MOST_OF_PEN", feeders: 5, heaters: 1, emptyAreas: ["the corner by the door"] } },
    { layout: null },
  ]);
  assert.equal(seen.pictures, 3);
  assert.equal(seen.widePictures, 2);
  assert.equal(seen.feeders, 6, "the most seen in a picture of (most of) the pen; part views do not count");
  assert.equal(seen.crowding.HEATER, 2, "counted once per picture");

  const a = penLayoutAdvice({ pen, live: 300, weightKg: 0.4, seen });
  assert.ok(a.recommendations.some((r) => /showed 1 heater, but 2 are recorded/.test(r.text)));
  assert.ok(a.recommendations.some((r) => /at most 6 feeders, but 8 are recorded/.test(r.text)));
  assert.ok(a.recommendations.some((r) => /bunched around the heat in several pictures/.test(r.text)));
  assert.ok(a.recommendations.some((r) => /the corner by the door/.test(r.text)));

  const blank = penLayoutAdvice({ pen: { ...pen, feederPans: 0 }, live: 300, weightKg: 0.4, seen });
  assert.equal(blank.recorded.feeders, null);
  assert.ok(!blank.recommendations.some((r) => /Add about .* feeder pan/.test(r.text)), "6 seen covers 300 birds");
});

test("a single crowded picture is not enough to call it a layout problem", () => {
  const seen = summariseSightings([{ layout: { view: "WHOLE_PEN", crowding: [{ at: "FEEDER" }] } }]);
  const a = penLayoutAdvice({ pen, live: 300, weightKg: 0.4, seen });
  assert.ok(!a.recommendations.some((r) => /crowded at the feeders/.test(r.text)));
});
