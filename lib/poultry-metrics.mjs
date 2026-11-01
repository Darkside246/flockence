export const FARM_TIME_ZONE = "America/Barbados";
export const EGG_GRADES = Object.freeze(["SMALL", "MEDIUM", "LARGE", "EXTRA_LARGE", "JUMBO", "UNGRADED"]);
export const LAYER_STAGES = Object.freeze(["CHICK", "GROWER", "PULLET", "PRE_LAY", "LAYING", "MOLT", "SPENT", "CLOSED"]);

const STAGE_TRANSITIONS = Object.freeze({
  CHICK: Object.freeze(["GROWER"]),
  GROWER: Object.freeze(["PULLET"]),
  PULLET: Object.freeze(["PRE_LAY"]),
  PRE_LAY: Object.freeze(["LAYING"]),
  LAYING: Object.freeze(["MOLT", "SPENT"]),
  MOLT: Object.freeze(["LAYING", "SPENT"]),
  SPENT: Object.freeze(["CLOSED"]),
  CLOSED: Object.freeze([]),
});

const OUTCOME_FIELDS = Object.freeze(["saleableEggs", "dirtyEggs", "crackedEggs", "floorEggs", "rejectedEggs"]);

function wholeCount(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/** Parse an ISO calendar date without accepting timestamps or rolling invalid days forward. */
export function parseCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Return a YYYY-MM-DD calendar date in the farm's operating timezone. */
export function calendarDateInTimeZone(value = new Date(), timeZone = FARM_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!fields.year || !fields.month || !fields.day) return null;
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch {
    return null;
  }
}

function dateTimePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** Format a timestamp for a datetime-local input using the farm's timezone. */
export function localDateTimeInTimeZone(value = new Date(), timeZone = FARM_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  try {
    const fields = dateTimePartsInTimeZone(date, timeZone);
    if (!fields.year || !fields.month || !fields.day || !fields.hour || !fields.minute) return null;
    return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
  } catch {
    return null;
  }
}

/** Parse a datetime-local value as a farm-local wall time, not server/browser time. */
export function parseDateTimeInTimeZone(value, timeZone = FARM_TIME_ZONE) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const calendarDate = `${yearText}-${monthText}-${dayText}`;
  if (
    parseCalendarDate(calendarDate) === null ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  ) return null;

  const targetWallTime = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
    Number(secondText),
  );
  let candidateMs = targetWallTime;

  try {
    // Reconcile the UTC guess with the wall clock shown in the target timezone.
    // A small bounded iteration avoids relying on the server's local timezone.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const fields = dateTimePartsInTimeZone(new Date(candidateMs), timeZone);
      const representedWallTime = Date.UTC(
        Number(fields.year),
        Number(fields.month) - 1,
        Number(fields.day),
        Number(fields.hour),
        Number(fields.minute),
        Number(fields.second),
      );
      const delta = targetWallTime - representedWallTime;
      candidateMs += delta;
      if (delta === 0) break;
    }

    const candidate = new Date(candidateMs);
    const fields = dateTimePartsInTimeZone(candidate, timeZone);
    const matches =
      fields.year === yearText &&
      fields.month === monthText &&
      fields.day === dayText &&
      fields.hour === hourText &&
      fields.minute === minuteText &&
      fields.second === secondText;
    return matches && Number.isFinite(candidateMs) ? candidate : null;
  } catch {
    return null;
  }
}

/** Reject future-effective entries using the farm calendar, including evening rollover. */
export function isCalendarDateNotFuture(value, now = new Date(), timeZone = FARM_TIME_ZONE) {
  if (value instanceof Date && !Number.isFinite(value.getTime())) return false;
  const date = value instanceof Date
    ? parseCalendarDate(value.toISOString().slice(0, 10))
    : parseCalendarDate(value);
  const current = new Date(now);
  if (date === null || !Number.isFinite(current.getTime())) return false;

  const currentCalendarDate = calendarDateInTimeZone(current, timeZone);
  return currentCalendarDate !== null && date.toISOString().slice(0, 10) <= currentCalendarDate;
}

/**
 * Assess a cold-storage reading against the limits configured for that location.
 * No limits is a distinct state, not a pass or a failure.
 */
export function assessStorageTemperature(temperatureC, minimumC, maximumC) {
  const temperature = temperatureC == null || temperatureC === "" ? null : Number(temperatureC);
  const minimum = minimumC == null || minimumC === "" ? null : Number(minimumC);
  const maximum = maximumC == null || maximumC === "" ? null : Number(maximumC);

  if (
    temperature === null || !Number.isFinite(temperature) ||
    (minimum !== null && !Number.isFinite(minimum)) ||
    (maximum !== null && !Number.isFinite(maximum)) ||
    (minimum !== null && maximum !== null && minimum > maximum)
  ) {
    return {
      status: "INVALID",
      inRange: false,
      belowMinimum: false,
      aboveMaximum: false,
      message: "Temperature or configured limits are invalid. Review the reading and location settings.",
    };
  }

  if (minimum === null && maximum === null) {
    return {
      status: "NO_LIMITS",
      inRange: null,
      belowMinimum: false,
      aboveMaximum: false,
      message: "No minimum or maximum temperature limits are configured for this location.",
    };
  }

  const belowMinimum = minimum !== null && temperature < minimum;
  const aboveMaximum = maximum !== null && temperature > maximum;
  if (belowMinimum || aboveMaximum) {
    const reasons = [];
    if (belowMinimum) reasons.push(`below the minimum of ${minimum}°C`);
    if (aboveMaximum) reasons.push(`above the maximum of ${maximum}°C`);
    return {
      status: "OUT_OF_RANGE",
      inRange: false,
      belowMinimum,
      aboveMaximum,
      message: `Reading ${temperature}°C is ${reasons.join(" and ")}. Review affected stock and record corrective action.`,
    };
  }

  return {
    status: "IN_RANGE",
    inRange: true,
    belowMinimum: false,
    aboveMaximum: false,
    message: "Reading is within the configured temperature limits.",
  };
}

/**
 * Calculate storage capacity indicators without hiding missing inventory weights.
 * Known weighted stock exceeding capacity is always an alert, even if other lots
 * still need weights. Utilisation is reported only when weight coverage is complete.
 */
export function assessStorageCapacity(recordedKg, capacityKg, unweighedItemCount = 0) {
  const recorded = recordedKg == null || recordedKg === "" ? null : Number(recordedKg);
  const capacity = capacityKg == null || capacityKg === "" ? null : Number(capacityKg);
  const unweighed = wholeCount(unweighedItemCount);

  if (
    recorded === null || !Number.isFinite(recorded) || recorded < 0 ||
    (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) ||
    unweighed === null
  ) {
    return {
      status: "INVALID",
      recordedKg: null,
      capacityKg: null,
      utilizationPercent: null,
      exceedsCapacity: false,
      weightCoverageComplete: false,
      message: "Recorded stock weight, capacity or missing-weight count is invalid.",
    };
  }

  const weightCoverageComplete = unweighed === 0;
  if (capacity === null || capacity === 0) {
    return {
      status: "NO_CAPACITY",
      recordedKg: recorded,
      capacityKg: capacity,
      utilizationPercent: null,
      exceedsCapacity: false,
      weightCoverageComplete,
      message: "No positive storage capacity is configured.",
    };
  }

  const exceedsCapacity = recorded > capacity;
  const utilizationRatio = recorded / capacity;
  const utilizationPercent = weightCoverageComplete
    ? Math.round(utilizationRatio * 1000) / 10
    : null;

  if (exceedsCapacity) {
    return {
      status: "EXCEEDED",
      recordedKg: recorded,
      capacityKg: capacity,
      utilizationPercent,
      exceedsCapacity: true,
      weightCoverageComplete,
      message: weightCoverageComplete
        ? "Recorded stock weight exceeds the configured capacity."
        : "Known stock weight already exceeds capacity; additional lots still need weight records.",
    };
  }

  if (!weightCoverageComplete) {
    return {
      status: "INCOMPLETE",
      recordedKg: recorded,
      capacityKg: capacity,
      utilizationPercent: null,
      exceedsCapacity: false,
      weightCoverageComplete: false,
      message: "Utilisation is unavailable because one or more assigned inventory lots have no usable weight.",
    };
  }

  if (utilizationRatio >= 0.9) {
    return {
      status: "NEAR_CAPACITY",
      recordedKg: recorded,
      capacityKg: capacity,
      utilizationPercent,
      exceedsCapacity: false,
      weightCoverageComplete: true,
      message: "Storage is at least 90% of configured capacity.",
    };
  }

  return {
    status: "IN_RANGE",
    recordedKg: recorded,
    capacityKg: capacity,
    utilizationPercent,
    exceedsCapacity: false,
    weightCoverageComplete: true,
    message: "Recorded stock weight is below 90% of configured capacity.",
  };
}

/** Remaining birds physically on the farm after deaths and processor dispatches. */
export function calculateLiveBirdsOnFarm(initialBirds, deaths, sentToProcessor = 0) {
  const initial = wholeCount(initialBirds);
  const mortality = wholeCount(deaths);
  const sent = wholeCount(sentToProcessor);
  if (initial === null || mortality === null || sent === null) return null;
  return Math.max(0, initial - mortality - sent);
}

/** Calculate interval FCR from whole-flock live biomass gain, not sample biomass. */
export function calculateIntervalFcr(feedKg, startingLiveBirds, startingAverageWeightKg, endingLiveBirds, endingAverageWeightKg) {
  const feed = Number(feedKg);
  const startBirds = wholeCount(startingLiveBirds);
  const endBirds = wholeCount(endingLiveBirds);
  const startWeight = Number(startingAverageWeightKg);
  const endWeight = Number(endingAverageWeightKg);
  if (
    !Number.isFinite(feed) || feed <= 0 ||
    startBirds === null || endBirds === null ||
    !Number.isFinite(startWeight) || startWeight <= 0 ||
    !Number.isFinite(endWeight) || endWeight <= 0
  ) return null;

  const biomassGainKg = endBirds * endWeight - startBirds * startWeight;
  return biomassGainKg > 0 ? feed / biomassGainKg : null;
}

/** Choose one representative live-weight record per date for trend calculations. */
export function selectDailyRepresentativeWeights(records) {
  if (!Array.isArray(records)) return [];
  const scopePriority = { BATCH_AVERAGE: 3, SAMPLE: 2, INDIVIDUAL: 1 };
  const selected = new Map();

  for (const row of records) {
    if (String(row?.liveOrDressed ?? "").toUpperCase() !== "LIVE") continue;
    const date = new Date(row?.date);
    const avgWeight = Number(row?.avgWeightKg);
    const quantity = wholeCount(row?.quantity);
    if (
      !Number.isFinite(date.getTime()) ||
      !Number.isFinite(avgWeight) || avgWeight <= 0 ||
      quantity === null || quantity < 1
    ) continue;

    const key = date.toISOString().slice(0, 10);
    const scope = String(row?.scope ?? "").toUpperCase();
    const priority = scopePriority[scope] ?? 0;
    const createdAt = new Date(row?.createdAt ?? 0);
    const createdAtMs = Number.isFinite(createdAt.getTime()) ? createdAt.getTime() : 0;
    const prior = selected.get(key);
    if (!prior || priority > prior.priority || (priority === prior.priority && createdAtMs > prior.createdAtMs)) {
      selected.set(key, { row, priority, createdAtMs, dateMs: date.getTime() });
    }
  }

  return [...selected.values()]
    .sort((a, b) => a.dateMs - b.dateMs)
    .map((entry) => entry.row);
}

/**
 * FCR requires a feed-use entry on every calendar day after the first weighing
 * through the second weighing. Multiple feed types on a day still count as one
 * covered day. Partial intervals must not be reported as complete.
 */
export function hasCompleteDailyFeedCoverage(feedDates, startDate, endDate) {
  if (!Array.isArray(feedDates)) return false;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const expectedDays = Math.round((endDay - startDay) / 86400000);
  if (expectedDays < 1) return false;

  const covered = new Set();
  for (const value of feedDates) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) continue;
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    if (day > startDay && day <= endDay) covered.add(new Date(day).toISOString().slice(0, 10));
  }
  return covered.size === expectedDays;
}

/** Prevent concurrent flock events from accounting for more birds than were placed. */
export function isWithinInitialFlockCount(initialBirds, deaths, sentToProcessor = 0, additionalDeaths = 0, additionalSent = 0) {
  const values = [initialBirds, deaths, sentToProcessor, additionalDeaths, additionalSent].map(wholeCount);
  if (values.some((value) => value === null)) return false;
  const [initial, mortality, sent, nextDeaths, nextSent] = values;
  return mortality + sent + nextDeaths + nextSent <= initial;
}

/**
 * Normalize an optional boolean from JSON API input. Invalid values are rejected
 * rather than relying on JavaScript truthiness (where Boolean("false") is true).
 */
export function normalizeOptionalBoolean(value) {
  if (value == null || value === "") return { valid: true, value: null };
  if (typeof value === "boolean") return { valid: true, value };
  if (value === "true") return { valid: true, value: true };
  if (value === "false") return { valid: true, value: false };
  return { valid: false, value: null };
}

/** Reconcile transport counts against a consistent slaughter dispatch. */
export function validateProcessorTripCounts(input) {
  const loaded = wholeCount(input?.birdsLoaded);
  const arrivedAlive = wholeCount(input?.birdsArrived);
  const deadOnArrival = wholeCount(input?.birdsDeadOnArrival);
  const sent = wholeCount(input?.sentQuantity);
  const slaughtered = wholeCount(input?.slaughtered);
  const condemned = wholeCount(input?.condemned);

  if (
    loaded === null || loaded < 1 ||
    arrivedAlive === null ||
    deadOnArrival === null ||
    sent === null || sent < 1 ||
    slaughtered === null ||
    condemned === null
  ) {
    return { valid: false, conflict: false, message: "Processor trip and slaughter dispatch counts must be valid whole numbers." };
  }
  if (slaughtered + condemned !== sent) {
    return {
      valid: false,
      conflict: true,
      message: "The linked slaughter dispatch does not reconcile: slaughtered birds plus condemned birds must equal birds sent.",
    };
  }
  if (loaded !== sent) {
    return { valid: false, conflict: true, message: "Birds loaded must match the linked slaughter dispatch quantity." };
  }
  if (arrivedAlive + deadOnArrival !== loaded) {
    return { valid: false, conflict: true, message: "Birds arriving alive plus dead on arrival must equal birds loaded." };
  }
  if (deadOnArrival > condemned) {
    return { valid: false, conflict: true, message: "Dead-on-arrival birds must be included in the linked slaughter event's condemned count." };
  }
  return { valid: true, conflict: false, message: null };
}

/**
 * Reconcile a dated bird-count snapshot with events that may have been entered
 * before or after that snapshot. A movement is already reflected only when its
 * effective date and record timestamp are both no later than the snapshot.
 */
export function reconcileLiveBirdsFromSnapshot(initialBirds, snapshot, movements = [], asOfDate = new Date()) {
  const initial = wholeCount(initialBirds);
  const asOf = new Date(asOfDate);
  if (initial === null || !Array.isArray(movements) || !Number.isFinite(asOf.getTime())) return null;

  let activeSnapshot = snapshot;
  if (activeSnapshot != null) {
    const snapshotDate = new Date(activeSnapshot.date);
    if (!Number.isFinite(snapshotDate.getTime())) return null;
    // Ignore a future-dated census when reporting the current on-farm count.
    if (snapshotDate.getTime() > asOf.getTime()) activeSnapshot = null;
  }

  const snapshotCount = activeSnapshot == null ? initial : wholeCount(activeSnapshot.liveCount);
  if (snapshotCount === null) return null;
  const snapshotDate = activeSnapshot == null ? null : new Date(activeSnapshot.date);
  const snapshotCreatedAt = activeSnapshot == null ? null : new Date(activeSnapshot.createdAt);
  if (activeSnapshot != null && (
    !Number.isFinite(snapshotDate.getTime()) ||
    !Number.isFinite(snapshotCreatedAt.getTime())
  )) return null;

  let unreflectedMovements = 0;
  for (const movement of movements) {
    const quantity = wholeCount(movement?.quantity);
    const movementDate = new Date(movement?.date);
    const recordedAt = new Date(movement?.createdAt);
    if (
      quantity === null ||
      !Number.isFinite(movementDate.getTime()) ||
      !Number.isFinite(recordedAt.getTime())
    ) return null;
    if (movementDate.getTime() > asOf.getTime()) continue;

    const alreadyCaptured = activeSnapshot != null &&
      movementDate.getTime() <= snapshotDate.getTime() &&
      recordedAt.getTime() <= snapshotCreatedAt.getTime();
    if (!alreadyCaptured) unreflectedMovements += quantity;
  }

  return Math.max(0, snapshotCount - unreflectedMovements);
}

/**
 * Reconcile the physical live count on a target calendar date. The caller
 * supplies the latest snapshot on or before that date, plus all recorded
 * movements effective on or before the target date.
 */
export function calculateLiveBirdsAtDate(initialBirds, snapshot, movements = [], asOfDate) {
  const initial = wholeCount(initialBirds);
  if (initial === null || !Array.isArray(movements)) return null;
  const target = new Date(asOfDate);
  if (!Number.isFinite(target.getTime())) return null;

  let live = initial;
  let snapshotDate = null;
  let snapshotCreatedAt = null;
  if (snapshot != null) {
    const count = wholeCount(snapshot.liveCount);
    snapshotDate = new Date(snapshot.date);
    snapshotCreatedAt = new Date(snapshot.createdAt);
    if (
      count === null ||
      !Number.isFinite(snapshotDate.getTime()) ||
      !Number.isFinite(snapshotCreatedAt.getTime()) ||
      snapshotDate.getTime() > target.getTime()
    ) return null;
    live = count;
  }

  let unreflected = 0;
  for (const movement of movements) {
    const quantity = wholeCount(movement?.quantity);
    const movementDate = new Date(movement?.date);
    const recordedAt = new Date(movement?.createdAt);
    if (
      quantity === null ||
      !Number.isFinite(movementDate.getTime()) ||
      !Number.isFinite(recordedAt.getTime())
    ) return null;
    if (movementDate.getTime() > target.getTime()) continue;

    const alreadyCaptured = snapshotDate !== null &&
      movementDate.getTime() <= snapshotDate.getTime() &&
      recordedAt.getTime() <= snapshotCreatedAt.getTime();
    if (!alreadyCaptured) unreflected += quantity;
  }

  return Math.max(0, live - unreflected);
}

export function validateEggCollectionInput(input) {
  const errors = [];
  const normalized = {};

  for (const field of ["liveHens", "totalEggs", ...OUTCOME_FIELDS]) {
    const value = wholeCount(input?.[field]);
    if (value === null) errors.push(`${field} must be a non-negative whole number.`);
    else normalized[field] = value;
  }

  if (normalized.liveHens !== undefined && normalized.liveHens < 1) {
    errors.push("At least one live hen must be recorded for an egg collection.");
  }

  const grades = [];
  const seen = new Set();
  if (!Array.isArray(input?.grades)) {
    errors.push("Egg grades must be supplied as a list.");
  } else {
    for (const row of input.grades) {
      const grade = String(row?.grade ?? "").toUpperCase();
      if (!EGG_GRADES.includes(grade)) {
        errors.push("An egg size grade is not supported.");
        continue;
      }
      if (seen.has(grade)) {
        errors.push("Each egg grade may be entered only once.");
        continue;
      }
      seen.add(grade);
      const quantity = wholeCount(row?.quantity);
      if (quantity === null) {
        errors.push(`${grade} eggs must be a non-negative whole number.`);
        continue;
      }
      grades.push({ grade, quantity });
    }
  }

  const outcomeValuesValid = OUTCOME_FIELDS.every((field) => normalized[field] !== undefined);
  if (outcomeValuesValid) {
    const outcomeTotal = OUTCOME_FIELDS.reduce((sum, field) => sum + normalized[field], 0);
    if (normalized.totalEggs !== outcomeTotal) {
      errors.push("Total eggs must equal saleable, dirty, cracked, floor and rejected eggs.");
    }
  }

  if (normalized.saleableEggs !== undefined && Array.isArray(input?.grades) && grades.length === input.grades.length) {
    const gradeTotal = grades.reduce((sum, row) => sum + row.quantity, 0);
    if (gradeTotal !== normalized.saleableEggs) {
      errors.push("Egg grades must add up to the saleable egg count. Put ungraded eggs under Ungraded.");
    }
  }

  const averageEggWeightG = input?.averageEggWeightG == null || input.averageEggWeightG === ""
    ? null
    : Number(input.averageEggWeightG);
  if (averageEggWeightG !== null && (!Number.isFinite(averageEggWeightG) || averageEggWeightG <= 0)) {
    errors.push("Average egg weight must be a positive number of grams.");
  }

  if (typeof input?.notes !== "undefined" && input.notes !== null && typeof input.notes !== "string") {
    errors.push("Notes must be text.");
  }

  if (errors.length) return { valid: false, errors };

  const gradeQuantities = new Map(grades.map((row) => [row.grade, row.quantity]));
  return {
    valid: true,
    value: {
      ...normalized,
      averageEggWeightG,
      notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) || null : null,
      grades: EGG_GRADES.map((grade) => ({ grade, quantity: gradeQuantities.get(grade) ?? 0 })),
    },
  };
}

export function calculateHenDayProduction(eggsCollected, liveHens) {
  const eggs = wholeCount(eggsCollected);
  const hens = wholeCount(liveHens);
  if (eggs === null || hens === null || hens === 0) return null;
  return (eggs / hens) * 100;
}

export function allowedNextLayerStages(currentStage) {
  if (currentStage == null || currentStage === "") return [...LAYER_STAGES];
  return [...(STAGE_TRANSITIONS[currentStage] ?? [])];
}

export function isValidLayerStageTransition(currentStage, nextStage) {
  if (!LAYER_STAGES.includes(nextStage)) return false;
  if (currentStage == null || currentStage === "") return true;
  return (STAGE_TRANSITIONS[currentStage] ?? []).includes(nextStage);
}

export function classifyProductionType(productionType, legacySpecies) {
  if (productionType === "BROILER" || productionType === "LAYER") return productionType;
  return String(legacySpecies ?? "").toUpperCase() === "LAYER" ? "LAYER" : "BROILER";
}

/** Plan a carton run against oldest-first egg lots without exceeding physical stock. */
export function buildEggPackingPlan(packSize, packCount, lots) {
  const size = wholeCount(packSize);
  const packs = wholeCount(packCount);
  if (size === null || size < 1 || size > 60) return { valid: false, errors: ["Pack size must be a whole number from 1 to 60 eggs."] };
  if (packs === null || packs < 1 || packs > 10000) return { valid: false, errors: ["Pack count must be a whole number from 1 to 10,000."] };
  if (!Array.isArray(lots)) return { valid: false, errors: ["Available egg lots are required."] };

  const totalEggs = size * packs;
  if (!Number.isSafeInteger(totalEggs)) return { valid: false, errors: ["The requested pack total is too large."] };

  const normalized = [];
  for (const lot of lots) {
    const id = typeof lot?.inventoryItemId === "string" ? lot.inventoryItemId : "";
    const availableEggs = wholeCount(lot?.availableEggs);
    if (!id || availableEggs === null) {
      return { valid: false, errors: ["Each source lot must have an ID and a whole non-negative egg quantity."] };
    }
    if (availableEggs > 0) {
      normalized.push({
        inventoryItemId: id,
        availableEggs,
        collectionDate: String(lot.collectionDate ?? ""),
      });
    }
  }

  normalized.sort((a, b) =>
    a.collectionDate.localeCompare(b.collectionDate) || a.inventoryItemId.localeCompare(b.inventoryItemId)
  );
  const availableEggs = normalized.reduce((sum, lot) => sum + lot.availableEggs, 0);
  if (availableEggs < totalEggs) {
    return {
      valid: false,
      availableEggs,
      totalEggs,
      errors: [`Requested ${totalEggs} eggs but only ${availableEggs} are available.`],
    };
  }

  let remaining = totalEggs;
  const allocations = [];
  for (const lot of normalized) {
    if (remaining === 0) break;
    const quantityEggs = Math.min(lot.availableEggs, remaining);
    if (quantityEggs > 0) allocations.push({ inventoryItemId: lot.inventoryItemId, quantityEggs });
    remaining -= quantityEggs;
  }

  if (remaining !== 0) return { valid: false, availableEggs, totalEggs, errors: ["The source lots could not cover the requested pack total."] };
  return { valid: true, totalEggs, availableEggs, allocations };
}

/**
 * Egg collections are recorded by calendar day. Apply a withdrawal from the
 * date treatment began through the date before the stated clearance boundary.
 * A missing clearance date remains blocked until an authorized review.
 */
export function isCollectionDateWithinWithdrawal(startedAt, clearsAt, collectionDate) {
  const started = new Date(startedAt);
  const collection = new Date(collectionDate);
  if (!Number.isFinite(started.getTime()) || !Number.isFinite(collection.getTime())) return false;
  const dayStart = Date.UTC(collection.getUTCFullYear(), collection.getUTCMonth(), collection.getUTCDate());
  const dayEnd = dayStart + 86400000;
  const clears = clearsAt == null || clearsAt === "" ? null : new Date(clearsAt);
  if (clears && !Number.isFinite(clears.getTime())) return false;
  return started.getTime() < dayEnd && (clears === null || clears.getTime() > dayStart);
}
