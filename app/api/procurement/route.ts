import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calculateLifecycle } from "@/lib/lifecycle";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const now = new Date();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 7);

  const leadTimeSetting = await prisma.setting.findUnique({
    where: { farmId_key: { farmId: currentFarmId(), key: "feed_reorder_lead_days" } },
  });
  const configuredLeadDays = Number(leadTimeSetting?.value ?? 7);
  const layerLeadDays = Number.isInteger(configuredLeadDays) ? Math.max(1, Math.min(60, configuredLeadDays)) : 7;

  const [purchases, usage, batches] = await Promise.all([
    prisma.feedPurchase.findMany({ where: { farmId: currentFarmId() }, orderBy: { date: "asc" } }),
    prisma.feedUsage.findMany({ where: { batch: { farmId: currentFarmId() }, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.batch.findMany({
      where: { farmId: currentFarmId(), status: "ACTIVE" },
      include: {
        weights: { where: { liveOrDressed: "LIVE" }, orderBy: { date: "desc" }, take: 2 },
        birdCounts: { orderBy: { date: "desc" }, take: 1 },
        mortalityEvents: true,
      },
    }),
  ]);

  const purchasedKg = purchases.reduce((sum, row) => sum + Number(row.bagSizeKg) * Number(row.quantityBags), 0);
  const usedKgLast7 = usage.reduce((sum, row) => sum + Number(row.quantityKg), 0);
  const totalUsageAgg = await prisma.feedUsage.aggregate({
    where: { batch: { farmId: currentFarmId() } },
    _sum: { quantityKg: true },
  });
  const usedKgTotal = Number(totalUsageAgg._sum.quantityKg ?? 0);

  const feedOnHandKg = Math.max(0, purchasedKg - usedKgTotal);
  const avgDailyFarmUsageKg = usedKgLast7 / 7;

  const batchNeeds = batches.map((batch) => {
    const batchUsage7 = usage.filter(row => row.batchId === batch.id).reduce((sum, row) => sum + Number(row.quantityKg), 0);
    const dailyUsage = batchUsage7 / 7;
    const isLayer = batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");
    if (isLayer) {
      // Layers remain in production beyond a broiler harvest window. Forecast only
      // the configurable supplier lead-time requirement, never a fictitious harvest date.
      return {
        batchId: batch.id, name: batch.name, productionType: "LAYER",
        planningBasis: "SUPPLIER_LEAD_TIME", remainingDays: layerLeadDays,
        dailyUsageKg: dailyUsage,
        projectedNeedKg: dailyUsage > 0 ? dailyUsage * layerLeadDays : null,
      };
    }

    const [latest, previous] = batch.weights;
    const lifecycle = calculateLifecycle({
      hatchDate: batch.hatchDate,
      purchaseDate: batch.purchaseDate,
      startDate: batch.startDate,
      targetAgeDays: batch.targetSlaughterAgeDays,
      decisionMode: batch.slaughterDecisionMode,
      targetLiveWeightKg: batch.targetLiveWeightKg ? Number(batch.targetLiveWeightKg) : null,
      latestLiveWeightKg: latest ? Number(latest.avgWeightKg) : null,
      latestWeightDate: latest?.date,
      previousLiveWeightKg: previous ? Number(previous.avgWeightKg) : null,
      previousWeightDate: previous?.date,
    });
    const projectedDays = lifecycle.projectedWeightDate ? Math.max(0, Math.ceil((lifecycle.projectedWeightDate.getTime() - now.getTime()) / 86400000)) : null;
    const remainingDays =
      batch.slaughterDecisionMode === "WEIGHT_TARGET" && projectedDays != null
        ? projectedDays
        : batch.slaughterDecisionMode === "AGE_OR_WEIGHT" && projectedDays != null
          ? Math.min(lifecycle.daysToAgeTarget, projectedDays)
          : lifecycle.daysToAgeTarget;
    return {
      batchId: batch.id, name: batch.name, productionType: "BROILER",
      planningBasis: "HARVEST_WINDOW", remainingDays, dailyUsageKg: dailyUsage,
      projectedNeedKg: dailyUsage > 0 ? dailyUsage * remainingDays : null,
    };
  });

  const projectedNeedKg = batchNeeds.reduce((sum, row) => sum + (row.projectedNeedKg ?? 0), 0);
  const safetyStockKg = avgDailyFarmUsageKg * 2;
  const reorderKg = Math.max(0, projectedNeedKg + safetyStockKg - feedOnHandKg);

  return NextResponse.json({
    generatedAt: now.toISOString(),
    feed: {
      purchasedKg: Number(purchasedKg.toFixed(2)),
      usedKgTotal: Number(usedKgTotal.toFixed(2)),
      usedKgLast7: Number(usedKgLast7.toFixed(2)),
      averageDailyUsageKg: Number(avgDailyFarmUsageKg.toFixed(2)),
      onHandEstimateKg: Number(feedOnHandKg.toFixed(2)),
      projectedNeedToAgeTargetKg: Number(projectedNeedKg.toFixed(2)),
      safetyStockKg: Number(safetyStockKg.toFixed(2)),
      reorderRecommendationKg: Number(reorderKg.toFixed(2)),
      reorderRecommended: reorderKg > 0,
    },
    batches: batchNeeds,
    notes: [
      "Feed on hand is an estimate based on recorded purchases minus recorded usage.",
      "Broiler projected need uses recorded seven-day feed use through the expected harvest window.",
      "Layer projected need uses recorded seven-day feed use over the configured supplier lead-time window; layer flocks are not assigned a broiler slaughter date.",
      "Configure the feed_reorder_lead_days farm setting to match the supplier lead time. The default is seven days until configured.",
      "A two-day safety stock is added when there is recent farm-wide usage.",
      "A farmer should verify physical feed stock before placing a purchase.",
    ],
  });
}
