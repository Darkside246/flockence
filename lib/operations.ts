import { prisma } from "./prisma";
import { alerts, farmScore } from "./insights";
import { calculateIntervalFcr, calculateLiveBirdsAtDate, hasCompleteDailyFeedCoverage, reconcileLiveBirdsFromSnapshot, selectDailyRepresentativeWeights } from "./poultry-metrics.mjs";

export const FARM_ID = process.env.FARM_ID ?? "default-farm";
export function money(minor: number) { return new Intl.NumberFormat("en-BB", { style: "currency", currency: "BBD" }).format(minor / 100); }
export function daysBetween(start: Date, end = new Date()) {
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.round((endDay - startDay) / 86400000));
}
// The farm row is made once per server process (security review 2026-11-01): this used to run a database write on every
// request, including every unsigned and forged one, so a flood of bad requests loaded the database for free.
let farmReady: Promise<unknown> | null = null;
export async function ensureFarm() {
  farmReady ??= prisma.farm.upsert({ where: { id: FARM_ID }, update: {}, create: { id: FARM_ID, name: "Alchemy Farms", currency: "BBD" } })
    .catch((error) => { farmReady = null; throw error; });
  return farmReady;
}

export async function dashboardData() {
  await ensureFarm();
  const [batches, sales, expenses, transport, inventory, household] = await Promise.all([
    prisma.batch.findMany({ where: { farmId: FARM_ID }, include: { birdCounts: { where: { date: { lte: new Date() } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1 }, mortalityEvents: true, feedPurchases: true, feedUsage: true, beddingPurchases: true, expenses: true, slaughterEvents: true } }),
    prisma.sale.findMany({ where: { farmId: FARM_ID, recordStatus: "ACTUAL" }, select: { totalMinor: true, amountPaidMinor: true } }),
    prisma.expense.findMany({ where: { farmId: FARM_ID, recordStatus: "ACTUAL" } }),
    prisma.transportationExpense.findMany({ where: { farmId: FARM_ID } }),
    prisma.inventoryItem.findMany({ where: { product: { farmId: FARM_ID }, status: { in: ["AVAILABLE", "RESERVED"] } }, include: { product: true } }),
    prisma.householdConsumption.aggregate({ where: { batch: { farmId: FARM_ID } }, _sum: { estimatedValueMinor: true } })
  ]);
  const liveCount = (batch: typeof batches[number]) => reconcileLiveBirdsFromSnapshot(
    batch.initialChicks,
    batch.birdCounts[0] ?? null,
    [
      ...batch.mortalityEvents.map(event => ({
        quantity: event.quantity, date: event.date, createdAt: event.createdAt,
      })),
      ...batch.slaughterEvents.map(event => ({
        quantity: event.sentQuantity, date: event.date, createdAt: event.createdAt,
      })),
    ],
  ) ?? 0;
  const active = batches.filter(batch => batch.status === "ACTIVE");
  const isLayer = (batch: typeof batches[number]) =>
    batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");
  const liveBroilerBirds = active.filter(batch => !isLayer(batch)).reduce((sum, batch) => sum + liveCount(batch), 0);
  const liveLayerBirds = active.filter(isLayer).reduce((sum, batch) => sum + liveCount(batch), 0);
  const activeBroilerFlocks = active.filter(batch => !isLayer(batch)).length;
  const activeLayerFlocks = active.filter(isLayer).length;
  const liveBirds = liveBroilerBirds + liveLayerBirds;
  const totalMortality = batches.reduce((sum, b) => sum + b.mortalityEvents.reduce((x, m) => x + m.quantity, 0), 0);
  const initial = batches.reduce((sum, b) => sum + b.initialChicks, 0);
  const salesTotal = sales.reduce((sum, s) => sum + s.totalMinor, 0);
  const cashCollected = sales.reduce((sum, s) => sum + s.amountPaidMinor, 0);
  const batchCosts = batches.reduce((sum, b) => {
    const feed = b.feedUsage.length ? b.feedUsage.reduce((x, f) => x + f.costMinor, 0) : b.feedPurchases.reduce((x, f) => x + Number(f.quantityBags) * f.unitCostMinor, 0);
    const bedding = b.beddingPurchases.reduce((x, p) => x + Number(p.quantity) * p.unitCostMinor, 0);
    const slaughter = b.slaughterEvents.reduce((x, s) => x + s.slaughterCostMinor, 0);
    const batchExpenses = b.expenses.reduce((x, e) => x + e.amountMinor, 0);
    return sum + b.initialChicks * b.chickCostMinor + feed + bedding + slaughter + batchExpenses;
  }, 0);
  const farmExpenses = expenses.filter(e => !e.batchId).reduce((sum, e) => sum + e.amountMinor, 0);
  const transportTotal = transport.reduce((sum, t) => sum + Math.max(t.actualCashMinor, t.economicMinor), 0);
  const inventoryValue = inventory.reduce((sum, i) => sum + (i.sellingPriceMinor != null ? Math.round(i.sellingPriceMinor * Number(i.quantity)) : i.costBasisMinor), 0);
  const householdValue = household._sum.estimatedValueMinor ?? 0;
  const economicCosts = batchCosts + farmExpenses + transportTotal;
  const economicProfit = salesTotal + inventoryValue + householdValue - economicCosts;
  const margin = salesTotal + inventoryValue + householdValue ? economicProfit / (salesTotal + inventoryValue + householdValue) : null;
  const mortalityRate = initial ? totalMortality / initial : 0;
  const score = farmScore({ mortalityRate, margin, inventoryTurnover: salesTotal ? Math.min(1, salesTotal / Math.max(1, inventoryValue + salesTotal)) : 0, expenseControl: economicCosts ? Math.max(0, Math.min(1, salesTotal / economicCosts)) : 0, consistency: batches.length ? Math.min(1, batches.filter(b => b.status !== "PLANNED").length / batches.length) : 0 });
  const alertRows = batches.map(b => ({ name: b.name, status: b.status, expectedSlaughter: b.expectedSlaughter, initialChicks: b.initialChicks, mortality: b.mortalityEvents.reduce((x,m)=>x+m.quantity,0) }));
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
