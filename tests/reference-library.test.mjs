import test from "node:test";
import assert from "node:assert/strict";
import { cobbTargetC, cobbDensityRangeC, thomasRangeC, guidanceFor, checkAgainstGuidance, NOT_HELD } from "../lib/reference-library.mjs";

test("Cobb 2020 temperature by age and humidity, as in the guide's table", () => {
  assert.equal(cobbTargetC(0, 30), 34);
  assert.equal(cobbTargetC(0, 70), 30);
  assert.equal(cobbTargetC(3, 60), 31);
  assert.equal(cobbTargetC(7, 50), 30);
  assert.equal(cobbTargetC(14, 60), 26);
  assert.equal(cobbTargetC(0, 55), 31.5, "between the guide's columns");
  assert.equal(cobbTargetC(0, 95), 30, "outside the table: the nearest column");
  assert.equal(cobbTargetC(25, 60), null, "grown birds go by stocking density instead");
});

test("Cobb 2020 temperature by stocking density for grown birds", () => {
  assert.deepEqual(cobbDensityRangeC(28), [22, 24]);
  assert.deepEqual(cobbDensityRangeC(33), [19, 21]);
  assert.deepEqual(cobbDensityRangeC(50), [14, 16]);
});

test("the Caribbean brooding schedule (Thomas 2017), °F converted", () => {
  assert.deepEqual(thomasRangeC(1), [32, 33]);
  assert.deepEqual(thomasRangeC(10), [29, 31]);
  assert.deepEqual(thomasRangeC(30), [21, 23]);
  assert.deepEqual(thomasRangeC(60), [20, 21]);
});

test("guidance for a young broiler names its sources; layers get the egg handling guide; missing guides are listed", () => {
  const g = guidanceFor({ kind: "broiler", ageDays: 3, rh: 60 });
  assert.ok(g.some((x) => x.topic === "Temperature" && /about 31 °C/.test(x.text) && /Cobb/.test(x.source)));
  assert.ok(g.some((x) => x.topic === "Temperature" && /32–33 °C/.test(x.text) && /Caribbean/.test(x.source)));
  assert.ok(g.some((x) => /1-gallon fountain per 100 chicks/.test(x.text)));
  assert.ok(g.some((x) => x.topic === "Feed" && /crumble to day 28/.test(x.text)));
  assert.ok(g.every((x) => x.source), "every line has a source");
  const old = guidanceFor({ kind: "broiler", ageDays: 30, densityKgM2: 30 });
  assert.ok(old.some((x) => /21–23 °C for grown birds/.test(x.text)));
  assert.ok(!old.some((x) => /fountain/.test(x.text)));
  assert.ok(guidanceFor({ kind: "broiler", ageDays: 10, naturalVentilation: false }).every((x) => !/1\.5 sq ft/.test(x.text)), "space per bird is for naturally ventilated houses");
  assert.match(guidanceFor({ kind: "layer", ageDays: 200 })[0].text, /3–4 times a day/);
  assert.deepEqual(NOT_HELD, ["Ross broiler handbook", "Hy-Line layer management guides", "WOAH animal welfare codes"]);
});

test("records against the guides: OK or check, with the reason", () => {
  const cold = checkAgainstGuidance({ kind: "broiler", ageDays: 3, tempC: 27, rh: 60 });
  assert.equal(cold[0].level, "CHECK");
  assert.match(cold[0].text, /27 °C recorded; the guide's target is about 31 °C: too cold for their age/);
  assert.equal(checkAgainstGuidance({ kind: "broiler", ageDays: 3, tempC: 31.5, rh: 60 })[0].level, "OK");
  const all = checkAgainstGuidance({ kind: "broiler", ageDays: 30, tempC: 26, ammoniaPpm: 30, densityKgM2: 33, litter: "Wet", m2PerBird: 0.12 });
  assert.equal(all.find((c) => c.topic === "Temperature").level, "CHECK", "26 °C is above 19–21 °C at 33 kg/m²");
  assert.equal(all.find((c) => c.topic === "Air").level, "CHECK");
  assert.ok(all.filter((c) => c.topic === "Space").every((c) => c.level === "CHECK"));
  assert.equal(all.find((c) => c.topic === "Litter").level, "CHECK");
  assert.equal(all.length, 5);
  assert.deepEqual(checkAgainstGuidance({ kind: "broiler", ageDays: 5 }), [], "nothing recorded, nothing judged");
});
