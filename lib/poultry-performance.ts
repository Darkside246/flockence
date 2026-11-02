import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { calendarDateInTimeZone, calculateIntervalFcr, calculateLiveBirdsAtDate, hasCompleteDailyFeedCoverage, parseCalendarDate, reconcileLiveBirdsFromSnapshot, selectDailyRepresentativeWeights } from "@/lib/poultry-metrics.mjs";

type BatchRow = {
  id: string;
  name: string;
  productionType: string | null;
  species: string;
  status: string;
  startDate: Date;
  expectedSlaughter: Date | null;
  targetLiveWeightKg: unknown;
  initialChicks: number;
  birdCounts: { date: Date; liveCount: number; createdAt: Date }[];
  mortalityEvents: { date: Date; quantity: number; createdAt: Date }[];
  weights: { date: Date; createdAt: Date; quantity: number; avgWeightKg: unknown; liveOrDressed: string; scope: string }[];
  feedUsage: { date: Date; quantityKg: unknown; costMinor: number }[];
  slaughterEvents: { date: Date; createdAt: Date; sentQuantity: number; slaughtered: number; condemned: number; liveWeightKg: unknown; dressedWeightKg: unknown }[];
  eggCollections: { date: Date; liveHens: number; totalEggs: number; saleableEggs: number; dirtyEggs: number; crackedEggs: number; floorEggs: number; rejectedEggs: number; withdrawalBlocked: boolean }[];
};

const n = (value: unknown) => {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
};

const isLayer = (batch: Pick<BatchRow, "productionType" | "species">) =>
  batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");

function flockMovements(batch: BatchRow) {
  return [
    ...batch.mortalityEvents.map((row) => ({
      quantity: row.quantity,
      date: row.date,
      createdAt: row.createdAt,
    })),
    ...batch.slaughterEvents.map((row) => ({
      quantity: row.sentQuantity,
      date: row.date,
      createdAt: row.createdAt,
    })),
  ];
}

function liveBirds(batch: BatchRow, asOfDate: Date) {
  return reconcileLiveBirdsFromSnapshot(
    batch.initialChicks,
    batch.birdCounts[0] ?? null,
    flockMovements(batch),
    asOfDate,
  ) ?? 0;
}

function liveBirdsAt(batch: BatchRow, date: Date) {
  const snapshot = batch.birdCounts
    .filter((row) => row.date.getTime() <= date.getTime())
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  return calculateLiveBirdsAtDate(
    batch.initialChicks,
    snapshot,
    flockMovements(batch),
    date,
  );
}

function mortality(batch: BatchRow) {
  const deaths = batch.mortalityEvents.reduce((sum, row) => sum + row.quantity, 0);
  return batch.initialChicks > 0 ? (deaths / batch.initialChicks) * 100 : null;
}

function intervalFcr(batch: BatchRow, feedCoverageStart: Date) {
  const weights = selectDailyRepresentativeWeights(batch.weights);
  if (weights.length < 2) return null;
  const previous = weights[weights.length - 2];
  const current = weights[weights.length - 1];
  const previousKg = n(previous.avgWeightKg);
  const currentKg = n(current.avgWeightKg);
  if (previousKg == null || currentKg == null || previous.date < feedCoverageStart) return null;

  const intervalFeed = batch.feedUsage.filter((row) => row.date > previous.date && row.date <= current.date);
  // Missing daily feed entries make an interval FCR incomplete. Do not present a
  // partial feed total as a reliable whole-flock conversion ratio.
  if (!hasCompleteDailyFeedCoverage(intervalFeed.map((row) => row.date), previous.date, current.date)) return null;
  const feedKg = intervalFeed.reduce((sum, row) => sum + (n(row.quantityKg) ?? 0), 0);
  const previousLiveBirds = liveBirdsAt(batch, previous.date);
  const currentLiveBirds = liveBirdsAt(batch, current.date);
  if (previousLiveBirds == null || currentLiveBirds == null) return null;

  return calculateIntervalFcr(feedKg, previousLiveBirds, previousKg, currentLiveBirds, currentKg);
}

function averageWeight(batch: BatchRow) {
  const measured = selectDailyRepresentativeWeights(batch.weights);
  const latest = measured[measured.length - 1];
  return latest ? n(latest.avgWeightKg) : null;
}

function dressingYield(batch: BatchRow) {
  const event = batch.slaughterEvents.find((row) => n(row.liveWeightKg) != null && n(row.dressedWeightKg) != null && (n(row.liveWeightKg) ?? 0) > 0);
  if (!event) return null;
  return ((n(event.dressedWeightKg) ?? 0) / (n(event.liveWeightKg) ?? 1)) * 100;
}

function layerMetrics(batch: BatchRow, end: Date) {
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const rows = batch.eggCollections.filter((row) => row.date >= start && row.date < new Date(end.getTime() + 86400000));
  if (!rows.length) {
    return {
      periodDays: 7,
      collectionCoverage: 0,
      eggs: 0,
      saleableEggs: 0,
      henDayProduction: null,
      saleableRate: null,
      feedKg: null,
      feedKgPerDozen: null,
      eggsPerHen: null,
      withdrawalBlockedCollections: 0,
    };
  }
  const eggs = rows.reduce((sum, row) => sum + row.totalEggs, 0);
  const saleableEggs = rows.reduce((sum, row) => sum + (row.withdrawalBlocked ? 0 : row.saleableEggs), 0);
  const liveHens = rows.reduce((sum, row) => sum + row.liveHens, 0);
  const withdrawalBlockedCollections = rows.filter((row) => row.withdrawalBlocked).length;
  const daysWithRows = new Set(rows.map((row) => row.date.toISOString().slice(0, 10))).size;
  return {
    periodDays: 7,
    collectionCoverage: daysWithRows / Math.min(7, Math.max(1, Math.floor((end.getTime() - batch.startDate.getTime()) / 86400000) + 1)),
    eggs,
    saleableEggs,
    henDayProduction: liveHens > 0 ? (eggs / liveHens) * 100 : null,
    saleableRate: eggs > 0 ? (saleableEggs / eggs) * 100 : null,
    feedKg: null,
    feedKgPerDozen: null,
    eggsPerHen: liveHens > 0 ? eggs / liveHens : null,
    withdrawalBlockedCollections,
  };
}

export async function getPoultryPerformance(farmId = currentFarmId(), date = new Date()) {
  const farmDate = calendarDateInTimeZone(date);
  const end = farmDate ? parseCalendarDate(farmDate) : null;
  if (!end) throw new Error("Could not resolve the farm calendar date for performance reporting.");
  const since7 = new Date(end);
  since7.setUTCDate(since7.getUTCDate() - 6);
  const feedCoverageStart = new Date(end);
  feedCoverageStart.setUTCDate(feedCoverageStart.getUTCDate() - 89);

  const batches = await prisma.batch.findMany({
    where: { farmId, status: { in: ["ACTIVE", "SLAUGHTERED", "CLOSED"] } },
    orderBy: { startDate: "desc" },
    take: 200,
    include: {
      birdCounts: { where: { date: { lte: end } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
      mortalityEvents: { orderBy: { date: "desc" } },
      weights: { where: { date: { gte: feedCoverageStart, lte: end } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 },
      feedUsage: { where: { date: { gte: feedCoverageStart, lte: end } }, orderBy: { date: "asc" } },
      slaughterEvents: { orderBy: { date: "desc" } },
      eggCollections: { where: { date: { gte: since7, lte: end } }, orderBy: { date: "asc" } },
    },
  }) as unknown as BatchRow[];

  const broilers = batches.filter((batch) => !isLayer(batch) && batch.status === "ACTIVE").map((batch) => {
    const currentLive = liveBirds(batch, end);
    const latestWeight = averageWeight(batch);
    const target = n(batch.targetLiveWeightKg);
    const daysToHarvest = batch.expectedSlaughter ? Math.max(0, Math.ceil((batch.expectedSlaughter.getTime() - end.getTime()) / 86400000)) : null;
    const fcr = intervalFcr(batch, feedCoverageStart);
    const mortalityPercent = mortality(batch);
    const yieldPercent = dressingYield(batch);
    const weightGap = target != null && latestWeight != null ? target - latestWeight : null;
    return {
      id: batch.id,
      name: batch.name,
      liveBirds: currentLive,
      mortalityPercent,
      latestLiveWeightKg: latestWeight,
      targetLiveWeightKg: target,
      weightGapKg: weightGap,
      intervalFcr: fcr,
      dressingYieldPercent: yieldPercent,
      expectedHarvestDate: batch.expectedSlaughter,
      daysToHarvest,
      feedUsed7dKg: batch.feedUsage.filter(row => row.date >= since7).reduce((sum, row) => sum + (n(row.quantityKg) ?? 0), 0),
      feedCost7dMinor: batch.feedUsage.filter(row => row.date >= since7).reduce((sum, row) => sum + row.costMinor, 0),
      signals: [
        target != null && latestWeight != null && weightGap != null && weightGap > 0 ? "WEIGHT_BELOW_CONFIGURED_TARGET" : null,
        batch.expectedSlaughter && daysToHarvest != null && daysToHarvest <= 3 ? "HARVEST_WINDOW_OPEN" : null,
      ].filter(Boolean),
    };
  });

  const layers = batches.filter((batch) => isLayer(batch) && batch.status === "ACTIVE").map((batch) => {
    const metrics = layerMetrics(batch, end);
    const feedKg7d = batch.feedUsage.filter(row => row.date >= since7).reduce((sum, row) => sum + (n(row.quantityKg) ?? 0), 0);
    const feedCost7dMinor = batch.feedUsage.filter(row => row.date >= since7).reduce((sum, row) => sum + row.costMinor, 0);
    const eggsPerHen = metrics.eggsPerHen;
    return {
      id: batch.id,
      name: batch.name,
      liveHens: liveBirds(batch, end),
      sevenDay: {
        ...metrics,
        feedKg: feedKg7d,
        feedKgPerDozen: metrics.eggs > 0 ? feedKg7d / (metrics.eggs / 12) : null,
        feedCostPerDozenMinor: metrics.eggs > 0 ? Math.round(feedCost7dMinor / (metrics.eggs / 12)) : null,
      },
      signals: [
        metrics.collectionCoverage < 1 ? "MISSING_COLLECTION_DAYS" : null,
        metrics.withdrawalBlockedCollections > 0 ? "WITHDRAWAL_HOLD_PRESENT" : null,
        eggsPerHen != null && eggsPerHen === 0 ? "NO_EGGS_RECORDED" : null,
      ].filter(Boolean),
    };
  });

  return {
    asOf: end.toISOString(),
    farm: {
      activeBroilerFlocks: broilers.length,
      activeLayerFlocks: layers.length,
      liveBroilers: broilers.reduce((sum, row) => sum + row.liveBirds, 0),
      liveLayerHens: layers.reduce((sum, row) => sum + row.liveHens, 0),
    },
    broilers,
    layers,
    dataQuality: {
      note: "Performance values are calculated from recorded farm data. Missing measurements are returned as null and are not replaced with assumptions.",
    },
  };
}
