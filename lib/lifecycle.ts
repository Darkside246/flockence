import { daysBetween } from "./operations";

export type LifecycleInput = {
  hatchDate?: Date | null;
  purchaseDate?: Date | null;
  startDate: Date;
  targetAgeDays?: number | null;
  decisionMode?: "AGE_TARGET" | "WEIGHT_TARGET" | "AGE_OR_WEIGHT" | "MANUAL";
  targetLiveWeightKg?: number | null;
  latestLiveWeightKg?: number | null;
  latestWeightDate?: Date | null;
  previousLiveWeightKg?: number | null;
  previousWeightDate?: Date | null;
};

export function lifecycleDate(input: LifecycleInput) {
  return input.hatchDate ?? input.purchaseDate ?? input.startDate;
}

export function lifecycleSource(input: LifecycleInput) {
  if (input.hatchDate) return "HATCH_DATE";
  if (input.purchaseDate) return "PURCHASE_DATE_ESTIMATE";
  return "START_DATE_ESTIMATE";
}

export function calculateLifecycle(input: LifecycleInput, today = new Date()) {
  const origin = lifecycleDate(input);
  const ageDays = daysBetween(origin, today);
  const targetAgeDays = Math.max(1, Math.round(input.targetAgeDays ?? 42));
  const ageTargetDate = new Date(origin);
  ageTargetDate.setUTCDate(ageTargetDate.getUTCDate() + targetAgeDays);

  let projectedWeightDate: Date | null = null;
  let adgKgPerDay: number | null = null;
  if (
    input.targetLiveWeightKg != null &&
    input.latestLiveWeightKg != null &&
    input.previousLiveWeightKg != null &&
    input.latestWeightDate &&
    input.previousWeightDate
  ) {
    const days = daysBetween(input.previousWeightDate, input.latestWeightDate);
    if (days > 0) {
      adgKgPerDay = (input.latestLiveWeightKg - input.previousLiveWeightKg) / days;
      if (adgKgPerDay > 0 && input.latestLiveWeightKg < input.targetLiveWeightKg) {
        const daysToTarget = Math.ceil((input.targetLiveWeightKg - input.latestLiveWeightKg) / adgKgPerDay);
        projectedWeightDate = new Date(input.latestWeightDate);
        projectedWeightDate.setUTCDate(projectedWeightDate.getUTCDate() + daysToTarget);
      } else if (input.latestLiveWeightKg >= input.targetLiveWeightKg) {
        projectedWeightDate = new Date(input.latestWeightDate);
      }
    }
  }

  const weightReady = input.targetLiveWeightKg != null && input.latestLiveWeightKg != null
    ? input.latestLiveWeightKg >= input.targetLiveWeightKg
    : false;

  let recommendation: "AGE_TARGET" | "WEIGHT_TARGET" | "AGE_TARGET_REACHED" | "CONTINUE" | "MANUAL_REVIEW" = "CONTINUE";
  if (input.decisionMode === "MANUAL") recommendation = "MANUAL_REVIEW";
  else if (input.decisionMode === "WEIGHT_TARGET" && weightReady) recommendation = "WEIGHT_TARGET";
  else if (input.decisionMode === "AGE_TARGET" && ageDays >= targetAgeDays) recommendation = "AGE_TARGET_REACHED";
  else if (input.decisionMode === "AGE_OR_WEIGHT" && (ageDays >= targetAgeDays || weightReady)) {
    recommendation = weightReady ? "WEIGHT_TARGET" : "AGE_TARGET_REACHED";
  }

  return {
    originDate: origin,
    source: lifecycleSource(input),
    ageDays,
    ageWeeks: Math.floor(ageDays / 7),
    daysToAgeTarget: Math.max(0, targetAgeDays - ageDays),
    ageTargetDate,
    projectedWeightDate,
    adgKgPerDay,
    weightReady,
    recommendation,
    isBeyondSixWeeks: ageDays > 42
  };
}
