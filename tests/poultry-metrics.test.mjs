import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedNextLayerStages,
  assessStorageCapacity,
  assessStorageTemperature,
  calculateHenDayProduction,
  calculateIntervalFcr,
  calculateLiveBirdsAtDate,
  selectDailyRepresentativeWeights,
  calculateLiveBirdsOnFarm,
  hasCompleteDailyFeedCoverage,
  isWithinInitialFlockCount,
  isCalendarDateNotFuture,
  calendarDateInTimeZone,
  localDateTimeInTimeZone,
  parseDateTimeInTimeZone,
  reconcileLiveBirdsFromSnapshot,
  buildEggPackingPlan,
  classifyProductionType,
  isValidLayerStageTransition,
  isCollectionDateWithinWithdrawal,
  parseCalendarDate,
  validateEggCollectionInput,
  validateProcessorTripCounts,
  normalizeOptionalBoolean,
} from "../lib/poultry-metrics.mjs";

const validCollection = {
  liveHens: 120,
  totalEggs: 108,
  saleableEggs: 100,
  dirtyEggs: 3,
  crackedEggs: 2,
  floorEggs: 2,
  rejectedEggs: 1,
  grades: [
    { grade: "SMALL", quantity: 10 },
    { grade: "MEDIUM", quantity: 30 },
    { grade: "LARGE", quantity: 40 },
    { grade: "EXTRA_LARGE", quantity: 20 },
  ],
};

test("accepts a fully reconciled layer egg collection", () => {
  const result = validateEggCollectionInput(validCollection);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.value.totalEggs, 108);
    assert.equal(result.value.grades.reduce((sum, row) => sum + row.quantity, 0), 100);
    assert.equal(result.value.grades.find((row) => row.grade === "UNGRADED")?.quantity, 0);
  }
});

test("rejects an egg outcome total that does not reconcile", () => {
  const result = validateEggCollectionInput({ ...validCollection, totalEggs: 109 });
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.errors.some((error) => error.includes("Total eggs")));
});

test("rejects grades that do not sum to saleable eggs", () => {
  const result = validateEggCollectionInput({
    ...validCollection,
    grades: [{ grade: "LARGE", quantity: 99 }],
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.errors.some((error) => error.includes("Egg grades")));
});

test("rejects duplicate grades, fractional counts and negative counts", () => {
  const duplicate = validateEggCollectionInput({
    ...validCollection,
    grades: [{ grade: "LARGE", quantity: 50 }, { grade: "LARGE", quantity: 50 }],
  });
  assert.equal(duplicate.valid, false);
  const fractional = validateEggCollectionInput({ ...validCollection, liveHens: 119.5 });
  assert.equal(fractional.valid, false);
  const negative = validateEggCollectionInput({ ...validCollection, crackedEggs: -1 });
  assert.equal(negative.valid, false);
});

test("requires an observed live-hen denominator", () => {
  assert.equal(validateEggCollectionInput({ ...validCollection, liveHens: 0 }).valid, false);
  assert.equal(calculateHenDayProduction(108, 120), 90);
  assert.equal(calculateHenDayProduction(108, 0), null);
  assert.equal(calculateHenDayProduction(108, -1), null);
});

test("enforces the layer lifecycle transition order", () => {
  assert.deepEqual(allowedNextLayerStages("PULLET"), ["PRE_LAY"]);
  assert.equal(isValidLayerStageTransition("PULLET", "LAYING"), false);
  assert.equal(isValidLayerStageTransition("PRE_LAY", "LAYING"), true);
  assert.equal(isValidLayerStageTransition("LAYING", "CHICK"), false);
  assert.equal(isValidLayerStageTransition("SPENT", "CLOSED"), true);
  assert.equal(isValidLayerStageTransition("CLOSED", "LAYING"), false);
});

test("keeps legacy production type classification stable", () => {
  assert.equal(classifyProductionType(null, "LAYER"), "LAYER");
  assert.equal(classifyProductionType(null, "BROILER_CHICKEN"), "BROILER");
  assert.equal(classifyProductionType("BROILER", "LAYER"), "BROILER");
});

test("allocates carton packing from the oldest available egg lots first", () => {
  const result = buildEggPackingPlan(12, 3, [
    { inventoryItemId: "new-lot", availableEggs: 20, collectionDate: "2026-10-28T00:00:00.000Z" },
    { inventoryItemId: "old-lot", availableEggs: 30, collectionDate: "2026-10-27T00:00:00.000Z" },
  ]);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.totalEggs, 36);
    assert.deepEqual(result.allocations, [
      { inventoryItemId: "old-lot", quantityEggs: 30 },
      { inventoryItemId: "new-lot", quantityEggs: 6 },
    ]);
  }
});

test("rejects carton packing when stock is short or lot counts are fractional", () => {
  const short = buildEggPackingPlan(30, 2, [
    { inventoryItemId: "lot-a", availableEggs: 40, collectionDate: "2026-10-27" },
  ]);
  assert.equal(short.valid, false);
  if (!short.valid) assert.ok(short.errors[0].includes("only 40"));

  const fractional = buildEggPackingPlan(12, 1, [
    { inventoryItemId: "lot-a", availableEggs: 11.5, collectionDate: "2026-10-27" },
  ]);
  assert.equal(fractional.valid, false);
});

test("rejects invalid carton sizes and pack counts", () => {
  assert.equal(buildEggPackingPlan(0, 1, []).valid, false);
  assert.equal(buildEggPackingPlan(61, 1, []).valid, false);
  assert.equal(buildEggPackingPlan(12, 0, []).valid, false);
});

test("applies egg withdrawal periods to whole collection days conservatively", () => {
  assert.equal(isCollectionDateWithinWithdrawal(
    "2026-10-27T14:00:00.000Z", "2026-10-30T14:00:00.000Z", "2026-10-27T00:00:00.000Z"
  ), true);
  assert.equal(isCollectionDateWithinWithdrawal(
    "2026-10-27T14:00:00.000Z", "2026-10-30T14:00:00.000Z", "2026-10-29T00:00:00.000Z"
  ), true);
  assert.equal(isCollectionDateWithinWithdrawal(
    "2026-10-27T14:00:00.000Z", "2026-10-30T00:00:00.000Z", "2026-10-30T00:00:00.000Z"
  ), false);
  assert.equal(isCollectionDateWithinWithdrawal(
    "2026-10-27T14:00:00.000Z", null, "2026-11-01T00:00:00.000Z"
  ), true);
  assert.equal(isCollectionDateWithinWithdrawal(
    "not-a-date", null, "2026-11-01T00:00:00.000Z"
  ), false);
});


test("parses only real ISO calendar dates for flock records", () => {
  assert.equal(parseCalendarDate("2026-10-29")?.toISOString(), "2026-10-29T00:00:00.000Z");
  assert.equal(parseCalendarDate("2026-02-29"), null);
  assert.equal(parseCalendarDate("2026-13-01"), null);
  assert.equal(parseCalendarDate("2026-10-29T12:00:00.000Z"), null);
  assert.equal(parseCalendarDate("29-10-2026"), null);
  assert.equal(parseCalendarDate(null), null);
});


test("reconciles live birds after mortality and processor dispatches", () => {
  assert.equal(calculateLiveBirdsOnFarm(120, 6, 80), 34);
  assert.equal(calculateLiveBirdsOnFarm(120, 120, 0), 0);
  assert.equal(calculateLiveBirdsOnFarm(120, -1, 0), null);
  assert.equal(isWithinInitialFlockCount(120, 6, 80, 34, 0), true);
  assert.equal(isWithinInitialFlockCount(120, 6, 80, 35, 0), false);
  assert.equal(isWithinInitialFlockCount(120, 6, 80, 0, 35), false);
  assert.equal(isWithinInitialFlockCount(120, 0, 0, 0, 120), true);
});


test("reconciles snapshots with movements entered later or dated in the future", () => {
  const snapshot = {
    liveCount: 100,
    date: "2026-10-28T00:00:00.000Z",
    createdAt: "2026-10-28T18:00:00.000Z",
  };
  const result = reconcileLiveBirdsFromSnapshot(120, snapshot, [
    // Already included in the observed snapshot.
    { quantity: 5, date: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-27T19:00:00.000Z" },
    // Later dispatch after the snapshot.
    { quantity: 10, date: "2026-10-29T00:00:00.000Z", createdAt: "2026-10-29T08:00:00.000Z" },
    // Backdated death entered after the snapshot.
    { quantity: 2, date: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z" },
  ], "2026-10-29T23:59:00.000Z");
  assert.equal(result, 88);
  assert.equal(reconcileLiveBirdsFromSnapshot(120, snapshot, [
    { quantity: 10, date: "2026-10-30T00:00:00.000Z", createdAt: "2026-10-29T08:00:00.000Z" },
  ], "2026-10-29T23:59:00.000Z"), 100);
  assert.equal(reconcileLiveBirdsFromSnapshot(120, null, [
    { quantity: 5, date: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-27T19:00:00.000Z" },
    { quantity: 10, date: "2026-10-29T00:00:00.000Z", createdAt: "2026-10-29T08:00:00.000Z" },
  ], "2026-10-29T23:59:00.000Z"), 105);
  assert.equal(reconcileLiveBirdsFromSnapshot(120, snapshot, [
    { quantity: -1, date: "2026-10-29", createdAt: "2026-10-29" },
  ]), null);
});


test("calculates interval FCR from whole-flock biomass rather than sample size", () => {
  assert.equal(calculateIntervalFcr(120, 100, 1, 90, 1.5), 120 / 35);
  assert.equal(calculateIntervalFcr(0, 100, 1, 90, 1.5), null);
  assert.equal(calculateIntervalFcr(120, 100, 1.5, 90, 1), null);
  assert.equal(calculateIntervalFcr(120, 100, 0, 90, 1.5), null);
});


test("calculates on-farm flock census as of a historical date", () => {
  const priorSnapshot = {
    liveCount: 100,
    date: "2026-10-28T00:00:00.000Z",
    createdAt: "2026-10-28T18:00:00.000Z",
  };
  const movements = [
    { quantity: 5, date: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-27T19:00:00.000Z" },
    { quantity: 10, date: "2026-10-29T00:00:00.000Z", createdAt: "2026-10-29T08:00:00.000Z" },
    { quantity: 2, date: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z" },
  ];
  assert.equal(calculateLiveBirdsAtDate(120, priorSnapshot, movements, "2026-10-28T00:00:00.000Z"), 98);
  assert.equal(calculateLiveBirdsAtDate(120, priorSnapshot, movements, "2026-10-29T00:00:00.000Z"), 88);
  assert.equal(calculateLiveBirdsAtDate(120, null, movements, "2026-10-28T00:00:00.000Z"), 113);
  assert.equal(calculateLiveBirdsAtDate(120, priorSnapshot, movements, "2026-10-27T00:00:00.000Z"), null);
});


test("allows current and historical dates but rejects future flock events", () => {
  const now = new Date("2026-10-29T15:00:00.000Z");
  assert.equal(isCalendarDateNotFuture("2026-10-29", now), true);
  assert.equal(isCalendarDateNotFuture("2026-10-28", now), true);
  assert.equal(isCalendarDateNotFuture("2026-10-30", now), false);
  assert.equal(isCalendarDateNotFuture("2026-02-29", now), false);
});


test("round-trips cold-chain datetime-local values in Barbados time", () => {
  const instant = new Date("2026-10-30T01:00:00.000Z");
  assert.equal(localDateTimeInTimeZone(instant), "2026-10-29T21:00");
  assert.equal(parseDateTimeInTimeZone("2026-10-29T21:00")?.toISOString(), "2026-10-30T01:00:00.000Z");
  assert.equal(parseDateTimeInTimeZone("2026-10-29T21:00:00")?.toISOString(), "2026-10-30T01:00:00.000Z");
  assert.equal(parseDateTimeInTimeZone("2026-02-30T12:00"), null);
  assert.equal(parseDateTimeInTimeZone("2026-10-29T24:00"), null);
  assert.equal(parseDateTimeInTimeZone("not-a-date"), null);
});

test("assesses storage capacity without overstating incomplete stock data", () => {
  assert.equal(assessStorageCapacity(80, 100, 0).status, "IN_RANGE");
  assert.equal(assessStorageCapacity(80, 100, 0).utilizationPercent, 80);

  const near = assessStorageCapacity(95, 100, 0);
  assert.equal(near.status, "NEAR_CAPACITY");
  assert.equal(near.utilizationPercent, 95);

  const exceeded = assessStorageCapacity(110, 100, 0);
  assert.equal(exceeded.status, "EXCEEDED");
  assert.equal(exceeded.exceedsCapacity, true);
  assert.equal(exceeded.utilizationPercent, 110);

  const incompleteButExceeded = assessStorageCapacity(110, 100, 2);
  assert.equal(incompleteButExceeded.status, "EXCEEDED");
  assert.equal(incompleteButExceeded.exceedsCapacity, true);
  assert.equal(incompleteButExceeded.utilizationPercent, null);
  assert.equal(incompleteButExceeded.weightCoverageComplete, false);

  const incomplete = assessStorageCapacity(40, 100, 2);
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.utilizationPercent, null);

  assert.equal(assessStorageCapacity(20, null, 0).status, "NO_CAPACITY");
  assert.equal(assessStorageCapacity(20, 0, 0).utilizationPercent, null);
  assert.equal(assessStorageCapacity(-1, 100, 0).status, "INVALID");
});

test("assesses cold-chain readings against configured storage limits", () => {
  assert.deepEqual(assessStorageTemperature(-18, -25, -15), {
    status: "IN_RANGE",
    inRange: true,
    belowMinimum: false,
    aboveMaximum: false,
    message: "Reading is within the configured temperature limits.",
  });

  const tooWarm = assessStorageTemperature(-10, -25, -18);
  assert.equal(tooWarm.status, "OUT_OF_RANGE");
  assert.equal(tooWarm.inRange, false);
  assert.equal(tooWarm.aboveMaximum, true);
  assert.equal(tooWarm.belowMinimum, false);

  const tooCold = assessStorageTemperature(-30, -25, -18);
  assert.equal(tooCold.status, "OUT_OF_RANGE");
  assert.equal(tooCold.belowMinimum, true);
  assert.equal(tooCold.aboveMaximum, false);

  assert.equal(assessStorageTemperature(4, null, null).status, "NO_LIMITS");
  assert.equal(assessStorageTemperature(4, 6, 2).status, "INVALID");
  assert.equal(assessStorageTemperature("not-a-number", 0, 5).status, "INVALID");
  assert.equal(assessStorageTemperature(4, 0, 5).inRange, true);
});

test("uses the farm calendar for dates recorded during the evening", () => {
  // 01:00 UTC on October 30 is still 21:00 on October 29 in Barbados.
  const eveningInBarbados = new Date("2026-10-30T01:00:00.000Z");
  assert.equal(calendarDateInTimeZone(eveningInBarbados), "2026-10-29");
  assert.equal(isCalendarDateNotFuture("2026-10-29", eveningInBarbados), true);
  assert.equal(isCalendarDateNotFuture("2026-10-30", eveningInBarbados), false);
  assert.equal(isCalendarDateNotFuture("not-a-date", eveningInBarbados), false);
});

test("selects one representative live weight per date", () => {
  const selected = selectDailyRepresentativeWeights([
    { date: "2026-10-28T00:00:00.000Z", createdAt: "2026-10-28T08:00:00.000Z", scope: "SAMPLE", liveOrDressed: "LIVE", quantity: 10, avgWeightKg: 1.4 },
    { date: "2026-10-28T00:00:00.000Z", createdAt: "2026-10-28T09:00:00.000Z", scope: "BATCH_AVERAGE", liveOrDressed: "LIVE", quantity: 100, avgWeightKg: 1.35 },
    { date: "2026-10-28T00:00:00.000Z", createdAt: "2026-10-28T10:00:00.000Z", scope: "SAMPLE", liveOrDressed: "LIVE", quantity: 20, avgWeightKg: 1.45 },
    { date: "2026-10-29T00:00:00.000Z", createdAt: "2026-10-29T08:00:00.000Z", scope: "SAMPLE", liveOrDressed: "LIVE", quantity: 10, avgWeightKg: 1.5 },
    { date: "2026-10-29T00:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z", scope: "SAMPLE", liveOrDressed: "DRESSED", quantity: 8, avgWeightKg: 1.1 },
  ]);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].scope, "BATCH_AVERAGE");
  assert.equal(selected[0].avgWeightKg, 1.35);
  assert.equal(selected[1].date, "2026-10-29T00:00:00.000Z");
});


test("requires feed usage on every day in an interval before reporting FCR", () => {
  const start = "2026-10-26T00:00:00.000Z";
  const end = "2026-10-29T00:00:00.000Z";
  assert.equal(hasCompleteDailyFeedCoverage([
    "2026-10-27T00:00:00.000Z",
    "2026-10-28T00:00:00.000Z",
    "2026-10-29T00:00:00.000Z",
  ], start, end), true);
  assert.equal(hasCompleteDailyFeedCoverage([
    "2026-10-27T00:00:00.000Z",
    "2026-10-29T00:00:00.000Z",
  ], start, end), false);
  assert.equal(hasCompleteDailyFeedCoverage([
    "2026-10-27T00:00:00.000Z",
    "2026-10-27T12:00:00.000Z",
    "2026-10-28T00:00:00.000Z",
    "2026-10-29T00:00:00.000Z",
  ], start, end), true);
  assert.equal(hasCompleteDailyFeedCoverage(["2026-10-26"], start, end), false);
  assert.equal(hasCompleteDailyFeedCoverage(["2026-10-27"], end, end), false);
});


test("reconciles processor transport counts with the slaughter dispatch", () => {
  const validDispatch = {
    slaughtered: 95,
    sentQuantity: 100,
    condemned: 5,
  };
  assert.deepEqual(validateProcessorTripCounts({
    ...validDispatch,
    birdsLoaded: 100,
    birdsArrived: 96,
    birdsDeadOnArrival: 4,
  }), { valid: true, conflict: false, message: null });

  assert.equal(validateProcessorTripCounts({
    ...validDispatch,
    birdsLoaded: 99,
    birdsArrived: 95,
    birdsDeadOnArrival: 4,
  }).conflict, true);

  assert.equal(validateProcessorTripCounts({
    ...validDispatch,
    birdsLoaded: 100,
    birdsArrived: 95,
    birdsDeadOnArrival: 4,
  }).valid, false);

  assert.equal(validateProcessorTripCounts({
    slaughtered: 94,
    sentQuantity: 100,
    condemned: 5,
    birdsLoaded: 100,
    birdsArrived: 96,
    birdsDeadOnArrival: 4,
  }).message, "The linked slaughter dispatch does not reconcile: slaughtered birds plus condemned birds must equal birds sent.");

  assert.equal(validateProcessorTripCounts({
    slaughtered: 97,
    sentQuantity: 100,
    condemned: 3,
    birdsLoaded: 100,
    birdsArrived: 96,
    birdsDeadOnArrival: 4,
  }).valid, false);
});


test("normalizes optional booleans without truthiness coercion", () => {
  assert.deepEqual(normalizeOptionalBoolean(true), { valid: true, value: true });
  assert.deepEqual(normalizeOptionalBoolean(false), { valid: true, value: false });
  assert.deepEqual(normalizeOptionalBoolean("true"), { valid: true, value: true });
  assert.deepEqual(normalizeOptionalBoolean("false"), { valid: true, value: false });
  assert.deepEqual(normalizeOptionalBoolean(null), { valid: true, value: null });
  assert.deepEqual(normalizeOptionalBoolean(""), { valid: true, value: null });
  assert.equal(normalizeOptionalBoolean("yes").valid, false);
  assert.equal(normalizeOptionalBoolean(1).valid, false);
});
