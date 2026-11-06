import test from "node:test";
import assert from "node:assert/strict";
import {
  birdBalance, dailyPopulation, birdDays, henDayProduction, classifyEggs, compareToBaseline, stockLedger,
  feedBalance, perBirdDay, feedConversion, feedCoverage, waterUsed, meterUsage, waterToFeed, temperatureExposure,
  recoveredWeight, calibrateYield, estimateLiveWeight, REFERENCE_YIELD, processingYield, storagePreflight, unusualChange, sumKg,
} from "../lib/farm-engine.mjs";

const ev = (type, quantity, date, extra = {}) => ({ type, quantity, date, createdAt: date + "T12:00:00Z", ...extra });

// ---- Test A: starting flock and mortality -------------------------------------------------------------------
test("A: 20 chicks, 2 die → 18; 1 more → 17, without anyone typing the live count", () => {
  const events = [ev("MORTALITY", 2, "2026-11-01")];
  assert.equal(birdBalance({ initialBirds: 20, events }).live, 18);
  events.push(ev("MORTALITY", 1, "2026-11-02"));
  const b = birdBalance({ initialBirds: 20, events });
  assert.equal(b.live, 17);
  assert.equal(b.mortality, 3);
  assert.deepEqual(b.steps.map(s => s.balance), [20, 18, 17]);
});

// ---- Test B: additions -------------------------------------------------------------------------------------
test("B: 17 + 5 added → 22, and the addition is its own line with its date", () => {
  const b = birdBalance({ initialBirds: 20, events: [ev("MORTALITY", 3, "2026-11-01"), ev("ADDITION", 5, "2026-11-03")] });
  assert.equal(b.live, 22);
  assert.equal(b.additions, 5);
  assert.deepEqual(b.steps.at(-1), { label: "Birds added", change: 5, balance: 22, date: "2026-11-03" });
});

test("culled, slaughtered and missing are kept apart from died", () => {
  const b = birdBalance({ initialBirds: 100, events: [ev("MORTALITY", 2, "2026-11-01"), ev("CULL", 1, "2026-11-01"), ev("MISSING", 1, "2026-11-02"), ev("SLAUGHTER", 50, "2026-11-03")] });
  assert.equal(b.live, 46);
  assert.equal(b.mortality, 2); assert.equal(b.culls, 1); assert.equal(b.missing, 1); assert.equal(b.slaughtered, 50);
});

test("transfers move birds between houses without changing the flock total", () => {
  const b = birdBalance({ initialBirds: 30, placementHouse: "House A", events: [ev("TRANSFER_OUT", 10, "2026-11-02", { fromHouse: "House A" }), ev("TRANSFER_IN", 10, "2026-11-02", { toHouse: "House B" })] });
  assert.equal(b.live, 30);
  assert.deepEqual(b.houses, [{ name: "House A", birds: 20 }, { name: "House B", birds: 10 }]);
});

test("a head count that disagrees is reported as unaccounted, never booked as mortality", () => {
  const b = birdBalance({ initialBirds: 20, events: [ev("MORTALITY", 2, "2026-11-01"), ev("MORTALITY", 1, "2026-11-05")], headCounts: [{ count: 16, date: "2026-11-03", createdAt: "2026-11-03T08:00:00Z" }] });
  assert.equal(b.mortality, 3);           // only the recorded deaths
  assert.equal(b.bookBalance, 17);        // what the records say
  assert.equal(b.live, 15);               // the count, then the death after it
  assert.deepEqual(b.lastHeadCount, { date: "2026-11-03", counted: 16, expected: 18, unaccounted: -2 });
});

test("as-of date ignores later events", () => {
  const events = [ev("MORTALITY", 2, "2026-11-01"), ev("MORTALITY", 4, "2026-11-04")];
  assert.equal(birdBalance({ initialBirds: 20, events, asOf: "2026-11-02" }).live, 18);
});

test("more birds out than in is refused, not shown as zero", () => {
  assert.equal(birdBalance({ initialBirds: 5, events: [ev("MORTALITY", 6, "2026-11-01")] }).ok, false);
});

// ---- Test F: slaughter and the live balance -------------------------------------------------------------------
test("F: 120 placed, 5 died, 100 slaughtered → 15 alive; slaughter is not mortality", () => {
  const b = birdBalance({ initialBirds: 120, events: [ev("MORTALITY", 5, "2026-11-01"), ev("SLAUGHTER", 100, "2026-11-10")] });
  assert.equal(b.live, 15);
  assert.equal(b.mortality, 5);
  assert.equal(b.slaughtered, 100);
});

test("bird-days use the actual population each day, not the opening count × days", () => {
  const pop = dailyPopulation({ initialBirds: 10, events: [ev("MORTALITY", 2, "2026-11-02")], from: "2026-11-01", to: "2026-11-03" });
  assert.deepEqual(pop.map(p => p.live), [10, 8, 8]);
  assert.equal(birdDays(pop), 26);   // not 30
});

// ---- Test C: egg production --------------------------------------------------------------------------------
test("C: 100 hens, 99 eggs → 99% hen-day; nothing is said about a non-laying hen", () => {
  const h = henDayProduction(99, 100);
  assert.equal(h.percent, 99);
  assert.equal(h.status, "CALCULATED");
  assert.ok(!("nonLaying" in h) && !("mortality" in h));
});

test("C: comparison uses the flock's own baseline, and reports above/below without a reason", () => {
  const c = compareToBaseline(99, [94, 95, 95, 96, 95, 94, 95]);
  assert.equal(c.baseline, 95);
  assert.equal(c.direction, "above");
  assert.equal(c.difference, 4);
  assert.ok(!("reason" in c));
  assert.equal(compareToBaseline(99, [95, 96]).ok, false);
});

// ---- Test D: egg damage and inventory -----------------------------------------------------------------------
test("D: 100 collected, 3 cracked, 2 broken → 95 saleable, 5 damaged; stock moves once", () => {
  const e = classifyEggs({ collected: 100, cracked: 3, broken: 2 });
  assert.equal(e.saleable, 95);
  assert.equal(e.damaged, 5);
  const s = stockLedger(0, [{ type: "COLLECTED", direction: "IN", quantity: e.saleable }]);
  assert.equal(s.closing, 95);
});

test("a breakdown larger than the collection is refused", () => {
  assert.equal(classifyEggs({ collected: 10, cracked: 8, broken: 5 }).ok, false);
});

// ---- Test E: feed ------------------------------------------------------------------------------------------
test("E: 300 kg + 150 kg, 100 kg issued, 5 kg left over, 2 kg spilt → store 350 kg, eaten 93 kg", () => {
  const f = feedBalance({ openingKg: 300, receivedKg: [150], issues: [{ issuedKg: 100, leftoverKg: 5, spillageKg: 2 }] });
  assert.equal(f.storeClosingKg, 350);
  assert.equal(f.issuedKg, 100);
  assert.equal(f.consumedKg, 93);
  assert.equal(f.spillageKg, 2);
  assert.equal(f.consumedStatus, "CALCULATED");
});

test("feed issued without a leftover measurement is not counted as eaten", () => {
  const f = feedBalance({ openingKg: 100, issues: [{ issuedKg: 40 }] });
  assert.equal(f.storeClosingKg, 60);
  assert.equal(f.consumedKg, null);
  assert.equal(f.consumedStatus, "MISSING");
});

test("kg are summed to the gram (no floating-point drift)", () => {
  assert.equal(sumKg([0.1, 0.2]), 0.3);
  assert.equal(feedBalance({ openingKg: 0.3, issues: [{ issuedKg: 0.1, leftoverKg: 0 }, { issuedKg: 0.2, leftoverKg: 0 }] }).storeClosingKg, 0);
});

test("feed per bird-day and feed conversion only when the data exists", () => {
  assert.equal(perBirdDay(26, 26), 1);
  assert.equal(perBirdDay(26, 0), null);
  assert.equal(feedConversion({ feedKg: 100, startBirds: 50, startAvgKg: null, endBirds: 48, endAvgKg: 2 }).ok, false);
  const fcr = feedConversion({ feedKg: 150, startBirds: 50, startAvgKg: 0.5, endBirds: 50, endAvgKg: 2.5 });
  assert.equal(fcr.fcr, 1.5);
  assert.equal(feedCoverage({ storeKg: 350, dailyUseKg: 50 }).daysOfFeed, 7);
  assert.equal(feedCoverage({ storeKg: 350, dailyUseKg: 50 }).status, "FORECAST");
});

// ---- water and heat ------------------------------------------------------------------------------------------
test("water: measured disappearance, meter resets flagged, ratio only with both", () => {
  assert.equal(waterUsed({ openingL: 1000, addedL: 500, closingL: 1300 }).litres, 200);
  assert.equal(waterUsed({ openingL: null, closingL: 1 }).ok, false);
  const m = meterUsage([{ at: "2026-11-01T06:00Z", reading: 100 }, { at: "2026-11-02T06:00Z", reading: 160 }, { at: "2026-11-03T06:00Z", reading: 5 }]);
  assert.equal(m[0].litres, 60);
  assert.equal(m[1].litres, null);
  assert.equal(waterToFeed(200, 100), 2);
  assert.equal(waterToFeed(200, null), null);
});

test("heat: extremes are kept, degree-hours counted, and an offline gap is not filled", () => {
  const r = temperatureExposure([
    { at: "2026-11-01T10:00:00Z", c: 30 }, { at: "2026-11-01T11:00:00Z", c: 34 }, { at: "2026-11-01T12:00:00Z", c: 34 },
    { at: "2026-11-01T18:00:00Z", c: 28 },   // 6-hour gap: sensor offline
  ], { high: 32 });
  assert.equal(r.maxC, 34);
  assert.equal(r.minC, 28);
  assert.equal(r.hoursAbove, 1);            // only 11:00-12:00 is above 32 in the covered time
  assert.equal(r.degreeHoursAbove, 2);       // 2 degrees × 1 hour
  assert.equal(r.hoursWithoutReadings, 6);
});

// ---- Test G: live weight worked back from output -------------------------------------------------------------
test("G: giblets inside the carcass are not counted twice", () => {
  const r = recoveredWeight({ carcassKg: 90, gibletsInsideCarcass: true, gibletsKg: 6 });
  assert.equal(r.totalKg, 90);
  assert.equal(r.definition, "CARCASS_WITH_GIBLETS");
  const r2 = recoveredWeight({ carcassKg: 90, gibletsKg: 6, feetKg: 3 });
  assert.equal(r2.totalKg, 99);
  assert.equal(r2.definition, "RECOVERED_TOTAL");
});

test("G: farm calibration gives an estimate with a range from the farm's own spread", () => {
  const samples = [0.72, 0.73, 0.74, 0.73].map(r => ({ definition: "CARCASS", liveKg: 100, recoveredKg: 100 * r }));
  const cal = calibrateYield(samples, "CARCASS");
  assert.equal(cal.n, 4);
  const est = estimateLiveWeight({ recoveredKg: 87.6, birds: 50, definition: "CARCASS", calibration: cal });
  assert.equal(est.status, "ESTIMATED");
  assert.equal(est.averageLiveKg, 2.4);                     // 1.752 / 0.73
  assert.ok(est.rangeKg[0] < 2.4 && est.rangeKg[1] > 2.4);
  assert.ok(est.rangeKg[1] - est.rangeKg[0] < 0.2);          // comes from the spread, not a fixed ±%
});

test("G: a ratio from one product definition is never applied to another", () => {
  const cal = calibrateYield([0.72, 0.73, 0.74].map(r => ({ definition: "CARCASS", liveKg: 100, recoveredKg: 100 * r })), "CARCASS");
  const est = estimateLiveWeight({ recoveredKg: 99, birds: 40, definition: "RECOVERED_TOTAL", calibration: cal });
  assert.equal(est.ok, false);
  assert.equal(est.status, "UNVERIFIED");
});

test("G: without calibration it is a labelled reference estimate, or nothing", () => {
  const est = estimateLiveWeight({ recoveredKg: 87.6, birds: 50, definition: "CARCASS", reference: REFERENCE_YIELD.CARCASS });
  assert.equal(est.reference, true);
  assert.match(est.basis, /Reference estimate/);
  assert.equal(estimateLiveWeight({ recoveredKg: 99, birds: 40, definition: "RECOVERED_TOTAL" }).ok, false);
});

test("processing yield shows the unaccounted part instead of inventing it", () => {
  const y = processingYield({ liveKg: 120, outputs: [{ kind: "EDIBLE", kg: 87.6 }, { kind: "BYPRODUCT", kg: 6 }] });
  assert.equal(y.yieldPercent, 73);
  assert.equal(y.unaccountedKg, 26.4);
  assert.equal(processingYield({ outputs: [{ kind: "EDIBLE", kg: 50 }] }).yieldPercent, null);
});

// ---- Test H: storage preflight -------------------------------------------------------------------------------
test("H: expected output against free space; shortfall reported", () => {
  const p = storagePreflight({ expectedKg: 90, capacityKg: 200, storedKg: 150 });
  assert.equal(p.fits, false);
  assert.equal(p.shortfallKg, 40);
  assert.equal(storagePreflight({ expectedKg: 40, capacityKg: 200, storedKg: 150 }).fits, true);
  assert.equal(storagePreflight({ expectedKg: 40, capacityKg: null, storedKg: 0 }).ok, false);
  assert.match(storagePreflight({ expectedKg: 10, capacityKg: 200, storedKg: 0, unweighedItems: 2 }).warning, /no weight/);
});

// ---- anomalies ---------------------------------------------------------------------------------------------
test("unusual changes: robust against one odd day, explains what and how much, never why", () => {
  const water = [200, 205, 198, 202, 201, 199, 203, 200];
  const u = unusualChange("Water used", 260, water, { unit: " L" });
  assert.equal(u.unusual, true);
  assert.match(u.explanation, /higher by 59.5 L/);
  assert.doesNotMatch(u.explanation, /disease|leak|because/i);
  assert.equal(unusualChange("Water used", 204, water).unusual, false);
  assert.equal(unusualChange("Water used", 204, [1, 2]).ok, false);
});

test("birds never assigned to a house are taken to be in the house the farmer moves them from", () => {
  const b = birdBalance({ initialBirds: 20, events: [ev("TRANSFER_OUT", 10, "2026-11-02", { fromHouse: "House A" }), ev("TRANSFER_IN", 10, "2026-11-02", { toHouse: "House B" })] });
  assert.equal(b.live, 20);
  assert.deepEqual(b.houses, [{ name: "Not assigned to a house", birds: 10 }, { name: "House B", birds: 10 }]);
  assert.equal(b.houseWarning, null);
});

import { feederConsumption, tankUsage, broilerTargetTemp, growthForecast } from "../lib/farm-engine.mjs";

test("E (daily): 100 kg put out, 5 kg left, 2 kg spilt → 93 kg eaten; the 5 kg carries into tomorrow", () => {
  const r = feederConsumption([
    { date: "2026-11-01", issuedKg: 100, leftoverKg: 5, spillageKg: 2 },
    { date: "2026-11-02", issuedKg: 95, leftoverKg: 4 },
  ]);
  assert.equal(r.days[0].eatenKg, 93);
  assert.equal(r.days[1].openingKg, 5);
  assert.equal(r.days[1].eatenKg, 96);       // 95 + 5 − 4
  assert.equal(r.eatenKg, 189);
});

test("a day without a leftover weighing is not counted as eaten, and breaks the carry-over", () => {
  const r = feederConsumption([
    { date: "2026-11-01", issuedKg: 100 },
    { date: "2026-11-02", issuedKg: 100, leftoverKg: 3 },
    { date: "2026-11-03", issuedKg: 100, leftoverKg: 2 },
  ]);
  assert.equal(r.days[0].eatenKg, null);
  assert.equal(r.days[1].eatenKg, null);     // how much was in the feeders at the start is not known
  assert.equal(r.days[2].eatenKg, 101);      // 100 + 3 − 2
  assert.equal(r.measuredDays, 1);
});

test("water tank: level, refills and other use give the water used; a rise without a refill is flagged", () => {
  const u = tankUsage([
    { at: "2026-11-01T06:00Z", levelL: 1000 },
    { at: "2026-11-02T06:00Z", levelL: 900, addedL: 300, otherUseL: 50 },
    { at: "2026-11-03T06:00Z", levelL: 950 },
  ]);
  assert.equal(u[0].litres, 350);   // 1000 + 300 − 900 − 50
  assert.equal(u[1].litres, null);
  assert.equal(u[1].status, "UNVERIFIED");
});

test("age-based house temperature follows the handbook table and holds at 20 °C from day 27", () => {
  assert.equal(broilerTargetTemp(0).targetC, 30);
  assert.equal(broilerTargetTemp(4.5).targetC, 27.5);
  assert.equal(broilerTargetTemp(21).targetC, 22);
  assert.equal(broilerTargetTemp(40).targetC, 20);
  assert.equal(broilerTargetTemp(-1), null);
});

test("growth forecast: needs 3 weighing days, gives a range from the fit, never far past the data", () => {
  assert.equal(growthForecast([{ ageDays: 7, kg: 0.18 }, { ageDays: 14, kg: 0.45 }]).ok, false);
  const s = [[7, 0.19], [14, 0.47], [21, 0.92], [28, 1.48], [35, 2.08]].map(([ageDays, kg]) => ({ ageDays, kg }));
  const f = growthForecast(s, { atAgeDays: 42, targetKg: 2.5 });
  assert.equal(f.model, "curve (quadratic)");
  assert.ok(f.atAge.kg > 2.6 && f.atAge.kg < 2.9, String(f.atAge.kg));
  assert.ok(f.atAge.rangeKg[0] < f.atAge.kg && f.atAge.rangeKg[1] > f.atAge.kg);
  assert.ok(f.reachesTargetAtAge >= 38 && f.reachesTargetAtAge <= 41, String(f.reachesTargetAtAge));
  assert.equal(growthForecast(s, { atAgeDays: 70 }).atAge, null);
  const line = growthForecast(s.slice(0, 3), { atAgeDays: 28 });
  assert.equal(line.model, "straight line");
  assert.equal(line.atAge.kg, 1.257);  // least squares through days 7, 14, 21
});
