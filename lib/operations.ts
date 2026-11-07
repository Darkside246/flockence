import { prisma } from "./prisma";
import { DEFAULT_FARM_ID, currentFarmId, currentFarmIdOrNull } from "./farm-scope";
import { alerts, farmScore } from "./insights";
import { calculateIntervalFcr, calculateLiveBirdsAtDate, hasCompleteDailyFeedCoverage, reconcileLiveBirdsFromSnapshot, selectDailyRepresentativeWeights } from "./poultry-metrics.mjs";

export function money(minor: number) { return new Intl.NumberFormat("en-BB", { style: "currency", currency: "BBD" }).format(minor / 100); }
export function daysBetween(start: Date, end = new Date()) {
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.round((endDay - startDay) / 86400000));
}
export { currentFarmId } from "./farm-scope";

// The single-farm install's farm row is made once per server process (security review 2026-11-01: this used to run a
// database write on every request, including every unsigned and forged one). Farms set up by Oriya already exist; for
// them this does nothing. Outside a farm (sign-in lookups) it does nothing either.
let farmReady: Promise<unknown> | null = null;
export async function ensureFarm() {
  const farmId = currentFarmIdOrNull();
  if (farmId !== DEFAULT_FARM_ID) return;
  farmReady ??= prisma.farm.upsert({ where: { id: DEFAULT_FARM_ID }, update: {}, create: { id: DEFAULT_FARM_ID, name: "Alchemy Farms", currency: "BBD" } })
    .catch((error) => { farmReady = null; throw error; });
  return farmReady;
}

export async function dashboardData() {
  await ensureFarm();
  const farmId = currentFarmId();
  // Totals are summed by the database instead of loading every feed entry, death and purchase of every flock ever kept
  // (that grew with each year of records). Same figures as before.
  const [batches, mortalityByBatch, feedUseByBatch, feedBought, bedding, slaughterByBatch, batchExpenseByBatch, farmExpenses, salesSum, transport, inventory, household] = await Promise.all([
    prisma.batch.findMany({ where: { farmId }, select: { id: true, name: true, status: true, productionType: true, species: true, initialChicks: true, chickCostMinor: true, expectedSlaughter: true } }),
    prisma.mortalityEvent.groupBy({ by: ["batchId"], where: { batch: { farmId } }, _sum: { quantity: true } }),
    prisma.feedUsage.groupBy({ by: ["batchId"], where: { batch: { farmId } }, _sum: { costMinor: true }, _count: { _all: true } }),
    prisma.feedPurchase.findMany({ where: { farmId, batchId: { not: null } }, select: { batchId: true, quantityBags: true, unitCostMinor: true } }),
    prisma.beddingPurchase.findMany({ where: { batch: { farmId } }, select: { batchId: true, quantity: true, unitCostMinor: true } }),
    prisma.slaughterEvent.groupBy({ by: ["batchId"], where: { batch: { farmId } }, _sum: { slaughterCostMinor: true } }),
    prisma.expense.groupBy({ by: ["batchId"], where: { farmId, batchId: { not: null } }, _sum: { amountMinor: true } }),
    prisma.expense.aggregate({ where: { farmId, recordStatus: "ACTUAL", batchId: null }, _sum: { amountMinor: true } }),
    prisma.sale.aggregate({ where: { farmId, recordStatus: "ACTUAL" }, _sum: { totalMinor: true, amountPaidMinor: true } }),
    prisma.transportationExpense.findMany({ where: { farmId }, select: { actualCashMinor: true, economicMinor: true } }),
    prisma.inventoryItem.findMany({ where: { product: { farmId }, status: { in: ["AVAILABLE", "RESERVED"] } }, select: { sellingPriceMinor: true, quantity: true, costBasisMinor: true } }),
    prisma.householdConsumption.aggregate({ where: { batch: { farmId } }, _sum: { estimatedValueMinor: true } }),
  ]);
  const by = <T extends { batchId: string | null }>(rows: T[], pick: (r: T) => number) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.batchId) m.set(r.batchId, (m.get(r.batchId) ?? 0) + pick(r));
    return m;
  };
  const deaths = by(mortalityByBatch, r => r._sum.quantity ?? 0);
  const feedUseCost = by(feedUseByBatch, r => r._sum.costMinor ?? 0);
  const feedUseCount = by(feedUseByBatch, r => r._count._all);
  const feedBoughtCost = by(feedBought, r => Number(r.quantityBags) * r.unitCostMinor);
  const beddingCost = by(bedding, r => Number(r.quantity) * r.unitCostMinor);
  const slaughterCost = by(slaughterByBatch, r => r._sum.slaughterCostMinor ?? 0);
  const batchExpenses = by(batchExpenseByBatch, r => r._sum.amountMinor ?? 0);

  const active = batches.filter(batch => batch.status === "ACTIVE");
  const activeIds = active.map(b => b.id);
  // live birds only for the flocks still on the farm
  const [snapshots, activeDeaths, activeSent] = activeIds.length ? await Promise.all([
    prisma.birdCount.findMany({ where: { batchId: { in: activeIds }, date: { lte: new Date() } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], distinct: ["batchId"] }),
    prisma.mortalityEvent.findMany({ where: { batchId: { in: activeIds } }, select: { batchId: true, quantity: true, date: true, createdAt: true } }),
    prisma.slaughterEvent.findMany({ where: { batchId: { in: activeIds } }, select: { batchId: true, sentQuantity: true, date: true, createdAt: true } }),
  ]) : [[], [], []];
  const liveCount = (batch: typeof batches[number]) => reconcileLiveBirdsFromSnapshot(
    batch.initialChicks,
    snapshots.find(s => s.batchId === batch.id) ?? null,
    [
      ...activeDeaths.filter(e => e.batchId === batch.id).map(event => ({ quantity: event.quantity, date: event.date, createdAt: event.createdAt })),
      ...activeSent.filter(e => e.batchId === batch.id).map(event => ({ quantity: event.sentQuantity, date: event.date, createdAt: event.createdAt })),
    ],
  ) ?? 0;
  const isLayer = (batch: typeof batches[number]) =>
    batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");
  const liveBroilerBirds = active.filter(batch => !isLayer(batch)).reduce((sum, batch) => sum + liveCount(batch), 0);
  const liveLayerBirds = active.filter(isLayer).reduce((sum, batch) => sum + liveCount(batch), 0);
  const activeBroilerFlocks = active.filter(batch => !isLayer(batch)).length;
  const activeLayerFlocks = active.filter(isLayer).length;
  const liveBirds = liveBroilerBirds + liveLayerBirds;
  const totalMortality = batches.reduce((sum, b) => sum + (deaths.get(b.id) ?? 0), 0);
  const initial = batches.reduce((sum, b) => sum + b.initialChicks, 0);
  const salesTotal = salesSum._sum.totalMinor ?? 0;
  const cashCollected = salesSum._sum.amountPaidMinor ?? 0;
  const batchCosts = batches.reduce((sum, b) => {
    const feed = (feedUseCount.get(b.id) ?? 0) > 0 ? (feedUseCost.get(b.id) ?? 0) : (feedBoughtCost.get(b.id) ?? 0);
    return sum + b.initialChicks * b.chickCostMinor + feed + (beddingCost.get(b.id) ?? 0) + (slaughterCost.get(b.id) ?? 0) + (batchExpenses.get(b.id) ?? 0);
  }, 0);
  const farmExpenseTotal = farmExpenses._sum.amountMinor ?? 0;
  const transportTotal = transport.reduce((sum, t) => sum + Math.max(t.actualCashMinor, t.economicMinor), 0);
  const inventoryValue = inventory.reduce((sum, i) => sum + (i.sellingPriceMinor != null ? Math.round(i.sellingPriceMinor * Number(i.quantity)) : i.costBasisMinor), 0);
  const householdValue = household._sum.estimatedValueMinor ?? 0;
  const economicCosts = batchCosts + farmExpenseTotal + transportTotal;
  const economicProfit = salesTotal + inventoryValue + householdValue - economicCosts;
  const margin = salesTotal + inventoryValue + householdValue ? economicProfit / (salesTotal + inventoryValue + householdValue) : null;
  const mortalityRate = initial ? totalMortality / initial : 0;
  const score = farmScore({ mortalityRate, margin, inventoryTurnover: salesTotal ? Math.min(1, salesTotal / Math.max(1, inventoryValue + salesTotal)) : 0, expenseControl: economicCosts ? Math.max(0, Math.min(1, salesTotal / economicCosts)) : 0, consistency: batches.length ? Math.min(1, batches.filter(b => b.status !== "PLANNED").length / batches.length) : 0 });
  const alertRows = batches.map(b => ({ name: b.name, status: b.status, expectedSlaughter: b.expectedSlaughter, initialChicks: b.initialChicks, mortality: deaths.get(b.id) ?? 0 }));
  return { liveBirds, liveBroilerBirds, liveLayerBirds, activeBroilerFlocks, activeLayerFlocks, activeBatches: active.length, mortalityCount: totalMortality, mortalityRate: initial ? mortalityRate : null, salesTotal, cashCollected, expenseTotal: economicCosts, inventoryValue, householdValue, economicProfit, farmScore: score, alerts: alerts(alertRows) };
}

export async function batchSummary(id: string) {
  const batch = await prisma.batch.findUnique({ where: { id }, include: { birdCounts: true, mortalityEvents: true, feedPurchases: true, feedUsage: true, beddingPurchases: true, expenses: true, slaughterEvents: true, weights: true, sales: true, householdUses: true, processingOutputs: true } });
  if (!batch) return null;
  const mortality = batch.mortalityEvents.reduce((s, x) => s + x.quantity, 0);
  const latestSnapshot = [...batch.birdCounts].filter(row => row.date <= new Date()).sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const movements = [
    ...batch.mortalityEvents.map(event => ({ quantity: event.quantity, date: event.date, createdAt: event.createdAt })),
    ...batch.slaughterEvents.map(event => ({ quantity: event.sentQuantity, date: event.date, createdAt: event.createdAt })),
  ];
  const survival = reconcileLiveBirdsFromSnapshot(batch.initialChicks, latestSnapshot, movements) ?? 0;
  const feedPurchase = batch.feedPurchases.reduce((s, x) => s + Number(x.quantityBags) * x.unitCostMinor, 0); const feedUsage = batch.feedUsage.reduce((s, x) => s + x.costMinor, 0); const feedCost = feedUsage || feedPurchase;
  const bedding = batch.beddingPurchases.reduce((s, x) => s + Number(x.quantity) * x.unitCostMinor, 0); const expenses = batch.expenses.reduce((s, x) => s + x.amountMinor, 0); const slaughter = batch.slaughterEvents.reduce((s, x) => s + x.slaughterCostMinor, 0);
  const revenue = batch.sales.reduce((s, x) => s + x.totalMinor, 0); const householdValue = batch.householdUses.reduce((s, x) => s + x.estimatedValueMinor, 0); const totalCost = batch.initialChicks * batch.chickCostMinor + feedCost + bedding + expenses + slaughter;
  const isLayerBatch = batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");
  const liveWeights = selectDailyRepresentativeWeights(batch.weights);
  const firstWeight = liveWeights[0]; const latestWeight = liveWeights[liveWeights.length - 1];
  const weightDays = firstWeight && latestWeight ? daysBetween(firstWeight.date, latestWeight.date) : 0;
  const adgKgPerDay = firstWeight && latestWeight && weightDays > 0 ? (Number(latestWeight.avgWeightKg) - Number(firstWeight.avgWeightKg)) / weightDays : null;
  const lifecycleAnchor = batch.hatchDate ?? batch.purchaseDate ?? batch.startDate;
  const baselineDays = firstWeight ? daysBetween(lifecycleAnchor, firstWeight.date) : 999;
  const liveBirdsAt = (date: Date) => {
    const snapshot = batch.birdCounts
      .filter(row => row.date.getTime() <= date.getTime())
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    return calculateLiveBirdsAtDate(batch.initialChicks, snapshot, movements, date);
  };
  const baselineSupported = !isLayerBatch && firstWeight && latestWeight &&
    firstWeight.quantity > 0 && latestWeight.quantity > 0 &&
    weightDays > 0 && baselineDays <= 2;
  const intervalFeedRows = baselineSupported
    ? batch.feedUsage.filter(f => f.date.getTime() > firstWeight!.date.getTime() && f.date.getTime() <= latestWeight!.date.getTime())
    : [];
  const feedCoverageComplete = Boolean(
    baselineSupported &&
    hasCompleteDailyFeedCoverage(
      intervalFeedRows.map(row => row.date),
      firstWeight!.date,
      latestWeight!.date,
    )
  );
  const intervalFeedKg = feedCoverageComplete
    ? intervalFeedRows.reduce((sum, row) => sum + Number(row.quantityKg), 0)
    : 0;
  const startingLiveBirds = baselineSupported ? liveBirdsAt(firstWeight!.date) : null;
  const endingLiveBirds = baselineSupported ? liveBirdsAt(latestWeight!.date) : null;
  const fcr = feedCoverageComplete && startingLiveBirds != null && endingLiveBirds != null
    ? calculateIntervalFcr(
        intervalFeedKg,
        startingLiveBirds,
        Number(firstWeight!.avgWeightKg),
        endingLiveBirds,
        Number(latestWeight!.avgWeightKg),
      )
    : null;
  const slaughterYield = batch.slaughterEvents.reduce((s,x) => s + (x.liveWeightKg && x.dressedWeightKg && Number(x.liveWeightKg) > 0 ? Number(x.dressedWeightKg) / Number(x.liveWeightKg) : 0), 0);
  const yieldCount = batch.slaughterEvents.filter(x => x.liveWeightKg && x.dressedWeightKg && Number(x.liveWeightKg) > 0).length;
  const averageDressingPercentage = yieldCount ? slaughterYield / yieldCount : null;
  const outputs = (batch as any).processingOutputs ?? [];
  const processingInventoryValue = outputs.reduce((sum:any,x:any) => sum + (x.unitPriceMinor != null ? Number(x.unitPriceMinor) * Number(x.quantity) : 0), 0);
  return { batch, mortality, survival, mortalityRate: batch.initialChicks ? mortality / batch.initialChicks : 0, feedCost, bedding, expenses, slaughter, revenue, household: householdValue, totalCost, economicProfit: revenue + householdValue - totalCost, costPerSurvivor: survival ? totalCost / survival : null, latestLiveWeightKg: latestWeight ? Number(latestWeight.avgWeightKg) : null, adgKgPerDay, fcr, averageDressingPercentage, processingInventoryValue };
}
