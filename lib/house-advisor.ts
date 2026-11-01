export type HousingType = "CONTROLLED" | "OPEN_SIDED_GOOD" | "OPEN_SIDED_HOT";

export const STANDARD_BASIS = {
  stocking: "Ross Management Handbook 2025",
  water: "Ross Pocket Guide 2025",
  feeders: "Cobb Management Guide 2021",
  airflow: "UMN Extension heat guidance",
} as const;

export function floorAreaM2(lengthM: number, widthM: number) {
  return Math.max(0, lengthM * widthM);
}

export function biomassKg(birds: number, avgWeightKg: number) {
  return Math.max(0, birds * avgWeightKg);
}

export function stockingDensityKgM2(lengthM: number, widthM: number, birds: number, avgWeightKg: number) {
  const area = floorAreaM2(lengthM, widthM);
  return area > 0 ? biomassKg(birds, avgWeightKg) / area : 0;
}

export function stockingLimitKgM2(type: HousingType) {
  return type === "CONTROLLED" ? 30 : type === "OPEN_SIDED_GOOD" ? 25 : 18;
}

export function feederPanRange(birds: number) {
  return { conservative: Math.ceil(birds / 45), upper: Math.ceil(birds / 65) };
}

export function nippleRange(birds: number, targetWeightKg: number) {
  const perNipple = targetWeightKg > 3 ? 9 : 12;
  return { perNipple, required: Math.ceil(birds / perNipple) };
}

export function chainFeederRange(birds: number) {
  return { minM: birds * 0.025, maxM: birds * 0.04 };
}

export function fcr(feedKg: number, previousBiomassKg: number, currentBiomassKg: number) {
  const gain = currentBiomassKg - previousBiomassKg;
  return feedKg > 0 && gain > 0 ? feedKg / gain : null;
}

export function feedWaterRatio(feedKg: number, waterLitres: number) {
  return feedKg > 0 && waterLitres >= 0 ? waterLitres / feedKg : null;
}
