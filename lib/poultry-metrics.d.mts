export const FARM_TIME_ZONE: string;
export function assessStorageCapacity(
  recordedKg: unknown,
  capacityKg: unknown,
  unweighedItemCount?: unknown,
): {
  status: "INVALID" | "NO_CAPACITY" | "EXCEEDED" | "INCOMPLETE" | "NEAR_CAPACITY" | "IN_RANGE";
  recordedKg: number | null;
  capacityKg: number | null;
  utilizationPercent: number | null;
  exceedsCapacity: boolean;
  weightCoverageComplete: boolean;
  message: string;
};
export function assessStorageTemperature(
  temperatureC: unknown,
  minimumC: unknown,
  maximumC: unknown,
): {
  status: "INVALID" | "NO_LIMITS" | "OUT_OF_RANGE" | "IN_RANGE";
  inRange: boolean | null;
  belowMinimum: boolean;
  aboveMaximum: boolean;
  message: string;
};
export function parseCalendarDate(value: unknown): Date | null;
export function calendarDateInTimeZone(value?: Date | string | number, timeZone?: string): string | null;
export function localDateTimeInTimeZone(value?: Date | string | number, timeZone?: string): string | null;
export function parseDateTimeInTimeZone(value: unknown, timeZone?: string): Date | null;
export function isCalendarDateNotFuture(value: unknown, now?: Date | string | number, timeZone?: string): boolean;
export function calculateLiveBirdsOnFarm(initialBirds: unknown, deaths: unknown, sentToProcessor?: unknown): number | null;
export function calculateIntervalFcr(feedKg: unknown, startingLiveBirds: unknown, startingAverageWeightKg: unknown, endingLiveBirds: unknown, endingAverageWeightKg: unknown): number | null;
export type RepresentativeWeight = { date: Date | string; createdAt?: Date | string | null; scope?: string | null; liveOrDressed?: string | null; quantity: unknown; avgWeightKg: unknown; [key: string]: unknown };
export function selectDailyRepresentativeWeights<T extends RepresentativeWeight>(records: T[]): T[];
export function selectDailyRepresentativeWeights(records: unknown): RepresentativeWeight[];
export function hasCompleteDailyFeedCoverage(feedDates: unknown, startDate: Date | string, endDate: Date | string): boolean;
export function isWithinInitialFlockCount(initialBirds: unknown, deaths: unknown, sentToProcessor?: unknown, additionalDeaths?: unknown, additionalSent?: unknown): boolean;
export function normalizeOptionalBoolean(value: unknown): { valid: boolean; value: boolean | null };
export function validateProcessorTripCounts(input: unknown): { valid: boolean; conflict: boolean; message: string | null };
export type BirdSnapshot = { liveCount: unknown; date: Date | string; createdAt: Date | string };
export type BirdMovement = { quantity: unknown; date: Date | string; createdAt: Date | string };
export function reconcileLiveBirdsFromSnapshot(initialBirds: unknown, snapshot: BirdSnapshot | null | undefined, movements?: BirdMovement[], asOfDate?: Date | string | number): number | null;
export function calculateLiveBirdsAtDate(initialBirds: unknown, snapshot: BirdSnapshot | null | undefined, movements: BirdMovement[], asOfDate: Date | string | number): number | null;
export type EggGrade = "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE" | "JUMBO" | "UNGRADED";
export type LayerStage = "CHICK" | "GROWER" | "PULLET" | "PRE_LAY" | "LAYING" | "MOLT" | "SPENT" | "CLOSED";
export type EggCollectionInput = {
  liveHens: unknown;
  totalEggs: unknown;
  saleableEggs: unknown;
  dirtyEggs: unknown;
  crackedEggs: unknown;
  floorEggs: unknown;
  rejectedEggs: unknown;
  grades: unknown;
  averageEggWeightG?: unknown;
  notes?: unknown;
};
export type ValidatedEggCollection = {
  liveHens: number;
  totalEggs: number;
  saleableEggs: number;
  dirtyEggs: number;
  crackedEggs: number;
  floorEggs: number;
  rejectedEggs: number;
  averageEggWeightG: number | null;
  notes: string | null;
  grades: { grade: EggGrade; quantity: number }[];
};
export function validateEggCollectionInput(input: EggCollectionInput): { valid: true; value: ValidatedEggCollection } | { valid: false; errors: string[] };
export function calculateHenDayProduction(eggsCollected: unknown, liveHens: unknown): number | null;
export function allowedNextLayerStages(currentStage: string | null | undefined): LayerStage[];
export function isValidLayerStageTransition(currentStage: string | null | undefined, nextStage: string): boolean;
export function classifyProductionType(productionType: string | null | undefined, legacySpecies: string | null | undefined): "BROILER" | "LAYER";
export const EGG_GRADES: readonly EggGrade[];
export const LAYER_STAGES: readonly LayerStage[];

export type EggPackLot = { inventoryItemId: string; availableEggs: unknown; collectionDate: string };
export type EggPackAllocation = { inventoryItemId: string; quantityEggs: number };
export function buildEggPackingPlan(
  packSize: unknown,
  packCount: unknown,
  lots: EggPackLot[],
): { valid: true; totalEggs: number; availableEggs: number; allocations: EggPackAllocation[] }
 | { valid: false; availableEggs?: number; totalEggs?: number; errors: string[] };

export function isCollectionDateWithinWithdrawal(startedAt: unknown, clearsAt: unknown, collectionDate: unknown): boolean;
