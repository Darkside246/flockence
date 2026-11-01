import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { currentUserOrResponse } from "@/lib/current-user";
import { calculateHenDayProduction } from "@/lib/poultry-metrics.mjs";

function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}
function stageOnDate(batch: {
  startDate: Date;
  layerStage: string | null;
  layerStageEvents: { date: Date; createdAt: Date; toStage: string }[];
}, key: string) {
  if (dayKey(batch.startDate) > key) return null;
  const latest = batch.layerStageEvents
    .filter((event) => dayKey(event.date) <= key)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (latest) return latest.toStage;
  return batch.layerStage || null;
}
function safePercent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();

  const { searchParams } = new URL(request.url);
  const toDate = parseDay(searchParams.get("to")) || new Date(Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()
  ));
  const defaultFrom = new Date(toDate);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const fromDate = parseDay(searchParams.get("from")) || defaultFrom;
  const batchId = searchParams.get("batchId") || null;

  if (fromDate > toDate) return NextResponse.json({ error: "Start date must be on or before end date." }, { status: 400 });
  const daysInWindow = Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  if (daysInWindow > 90) return NextResponse.json({ error: "Performance windows are limited to 90 days. Use the reports export for longer periods." }, { status: 400 });

  const endExclusive = new Date(toDate.getTime() + 86400000);
  const layerWhere = {
    farmId: FARM_ID,
    OR: [
      { productionType: "LAYER" as const },
      { productionType: null, species: "LAYER" },
    ],
    ...(batchId ? { id: batchId } : {}),
    startDate: { lt: endExclusive },
  };

  const [batches, collections, feedUsage, cumulativeEggs, mortality] = await Promise.all([
    prisma.batch.findMany({
      where: layerWhere,
      select: {
        id: true, name: true, initialChicks: true, startDate: true, status: true,
        layerStage: true,
        layerStageEvents: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
      },
      orderBy: { startDate: "asc" },
      take: 500,
    }),
    prisma.eggCollection.findMany({
      where: {
        farmId: FARM_ID,
        date: { gte: fromDate, lt: endExclusive },
        batch: { farmId: FARM_ID, OR: [{ productionType: "LAYER" }, { productionType: null, species: "LAYER" }] },
        ...(batchId ? { batchId } : {}),
      },
      select: {
        id: true, batchId: true, date: true, liveHens: true, totalEggs: true,
        saleableEggs: true, dirtyEggs: true, crackedEggs: true, floorEggs: true,
        rejectedEggs: true, withdrawalBlocked: true, averageEggWeightG: true,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 10000,
    }),
    prisma.feedUsage.findMany({
      where: {
        batch: { farmId: FARM_ID, OR: [{ productionType: "LAYER" }, { productionType: null, species: "LAYER" }] },
        date: { gte: fromDate, lt: endExclusive },
        ...(batchId ? { batchId } : {}),
      },
      select: { batchId: true, date: true, quantityKg: true, costMinor: true, feedType: true },
      orderBy: [{ date: "asc" }],
      take: 10000,
    }),
    prisma.eggCollection.groupBy({
      by: ["batchId"],
      where: {
        farmId: FARM_ID,
        date: { lt: endExclusive },
        batch: { farmId: FARM_ID, OR: [{ productionType: "LAYER" }, { productionType: null, species: "LAYER" }] },
        ...(batchId ? { batchId } : {}),
      },
      _sum: { totalEggs: true },
    }),
    prisma.mortalityEvent.groupBy({
      by: ["batchId"],
      where: {
        date: { lt: endExclusive },
        batch: { farmId: FARM_ID, OR: [{ productionType: "LAYER" }, { productionType: null, species: "LAYER" }] },
        ...(batchId ? { batchId } : {}),
      },
      _sum: { quantity: true },
    }),
  ]);

  const rowsByDay = new Map<string, typeof collections>();
  for (const collection of collections) {
    const key = dayKey(collection.date);
    const rows = rowsByDay.get(key) || [];
    rows.push(collection);
    rowsByDay.set(key, rows);
  }

  const daily = [];
  let completeEggs = 0;
  let completeLiveHens = 0;
  let completeSaleableEggs = 0;
  let completeNonSaleableEggs = 0;
  let completeEggMassG = 0;
  let missingCollectionDays = 0;

  for (let index = 0; index < daysInWindow; index++) {
    const date = new Date(fromDate);
    date.setUTCDate(date.getUTCDate() + index);
    const key = dayKey(date);
    const layingBatches = batches.filter((batch) => stageOnDate(batch, key) === "LAYING");
    const batchIds = new Set(layingBatches.map((batch) => batch.id));
    const dayRows = (rowsByDay.get(key) || []).filter((row) => batchIds.has(row.batchId));
    const recordedIds = new Set(dayRows.map((row) => row.batchId));
    const missing = Math.max(0, layingBatches.length - recordedIds.size);
    const eggs = dayRows.reduce((sum, row) => sum + row.totalEggs, 0);
    const liveHens = dayRows.reduce((sum, row) => sum + row.liveHens, 0);
    const saleable = dayRows.reduce((sum, row) => sum + (row.withdrawalBlocked ? 0 : row.saleableEggs), 0);
    const nonSaleable = dayRows.reduce((sum, row) => sum + (row.withdrawalBlocked
      ? row.totalEggs
      : row.dirtyEggs + row.crackedEggs + row.floorEggs + row.rejectedEggs), 0);
    const complete = layingBatches.length > 0 && missing === 0 && liveHens > 0;
    const rowEggMass = dayRows.filter((row) => row.averageEggWeightG != null)
      .reduce((sum, row) => sum + row.totalEggs * Number(row.averageEggWeightG), 0);
    if (complete) {
      completeEggs += eggs;
      completeLiveHens += liveHens;
      completeSaleableEggs += saleable;
      completeNonSaleableEggs += nonSaleable;
      const dayRowsWithWeights = dayRows.filter((row) => row.averageEggWeightG != null);
      if (dayRowsWithWeights.length === dayRows.length && dayRows.length > 0) {
        completeEggMassG += rowEggMass;
      }
    }
    if (layingBatches.length > 0 && missing > 0) missingCollectionDays++;

    daily.push({
      date: key,
      layingFlocks: layingBatches.length,
      recordedFlocks: recordedIds.size,
      missingFlocks: missing,
      complete,
      totalEggs: eggs,
      saleableEggs: complete ? saleable : null,
      nonSaleableEggs: complete ? nonSaleable : null,
      liveHens: complete ? liveHens : null,
      henDayProduction: complete ? calculateHenDayProduction(eggs, liveHens) : null,
      saleableRate: complete && eggs > 0 ? safePercent(saleable, eggs) : null,
      averageEggMassPerHenG: complete && dayRows.length > 0 && dayRows.every((row) => row.averageEggWeightG != null)
        ? rowEggMass / liveHens
        : null,
    });
  }

  const cumulativeByBatch = new Map(cumulativeEggs.map((row) => [row.batchId, Number(row._sum.totalEggs || 0)]));
  const mortalityByBatch = new Map(mortality.map((row) => [row.batchId, Number(row._sum.quantity || 0)]));
  const byFlock = batches.map((batch) => {
    const records = collections.filter((row) => row.batchId === batch.id);
    const expectedLayingDates: string[] = [];
    for (let index = 0; index < daysInWindow; index++) {
      const date = new Date(fromDate);
      date.setUTCDate(date.getUTCDate() + index);
      const key = dayKey(date);
      if (stageOnDate(batch, key) === "LAYING") expectedLayingDates.push(key);
    }
    const recordsByDate = new Map(records.map((row) => [dayKey(row.date), row]));
    const missingCollectionDays = expectedLayingDates.filter((key) => !recordsByDate.has(key) || (recordsByDate.get(key)?.liveHens ?? 0) < 1).length;
    const flockWindowComplete = expectedLayingDates.length > 0 && missingCollectionDays === 0;
    const completeRecords = records.filter((row) => expectedLayingDates.includes(dayKey(row.date)) && row.liveHens > 0);
    const eggsInWindow = completeRecords.reduce((sum, row) => sum + row.totalEggs, 0);
    const saleableInWindow = completeRecords.reduce((sum, row) => sum + (row.withdrawalBlocked ? 0 : row.saleableEggs), 0);
    const initialHens = batch.initialChicks;
    const deathsToDate = mortalityByBatch.get(batch.id) || 0;
    const latestRecordedHens = [...records].reverse().find((row) => row.liveHens > 0)?.liveHens ?? null;
    const usage = feedUsage.filter((row) => row.batchId === batch.id);
    const feedKg = usage.reduce((sum, row) => sum + Number(row.quantityKg), 0);
    const feedCostMinor = usage.reduce((sum, row) => sum + row.costMinor, 0);
    const saleableDozens = saleableInWindow / 12;
    const weightedEggMass = completeRecords.filter((row) => row.averageEggWeightG != null)
      .reduce((sum, row) => sum + row.totalEggs * Number(row.averageEggWeightG), 0);
    const weightsAvailable = completeRecords.length > 0 && completeRecords.every((row) => row.averageEggWeightG != null);
    const feedCoverageRows = usage.filter((row) => expectedLayingDates.includes(dayKey(row.date)));
    const feedKgForFlock = feedCoverageRows.reduce((sum, row) => sum + Number(row.quantityKg), 0);
    const feedCostForFlock = feedCoverageRows.reduce((sum, row) => sum + row.costMinor, 0);
    return {
      id: batch.id,
      name: batch.name,
      stage: stageOnDate(batch, dayKey(toDate)),
      status: batch.status,
      initialHens,
      recordedMortalityToDate: deathsToDate,
      survivalRate: initialHens > 0 ? safePercent(Math.max(0, initialHens - deathsToDate), initialHens) : null,
      latestRecordedLiveHens: latestRecordedHens,
      eggsInWindow,
      saleableEggsInWindow: saleableInWindow,
      henHousedEggsToDate: cumulativeByBatch.get(batch.id) || 0,
      cumulativeHenHousedProduction: initialHens > 0 ? safePercent(cumulativeByBatch.get(batch.id) || 0, initialHens) : null,
      periodHenDayProduction: flockWindowComplete
        ? calculateHenDayProduction(eggsInWindow, completeRecords.reduce((sum, row) => sum + row.liveHens, 0))
        : null,
      saleableRate: flockWindowComplete && eggsInWindow > 0 ? safePercent(saleableInWindow, eggsInWindow) : null,
      missingCollectionDays,
      completeLayingDays: completeRecords.length,
      feedKgInWindow: feedKgForFlock,
      feedCostMinorInWindow: feedCostForFlock,
      feedKgPerDozenSaleableEggs: flockWindowComplete && saleableDozens > 0 ? feedKgForFlock / saleableDozens : null,
      recordedFeedCostPerDozenMinor: flockWindowComplete && saleableDozens > 0 ? feedCostForFlock / saleableDozens : null,
      eggMassPerRecordedHenDayG: flockWindowComplete && weightsAvailable
        ? weightedEggMass / Math.max(1, completeRecords.reduce((sum, row) => sum + row.liveHens, 0))
        : null,
    };
  });

  const completeDateKeys = new Set(daily.filter((row) => row.complete).map((row) => row.date));
  const feedOnCompleteDays = feedUsage.filter((row) => completeDateKeys.has(dayKey(row.date)));
  const feedKg = feedOnCompleteDays.reduce((sum, row) => sum + Number(row.quantityKg), 0);
  const feedCostMinor = feedOnCompleteDays.reduce((sum, row) => sum + row.costMinor, 0);
  const saleableDozens = completeSaleableEggs / 12;
  const allWeightDaysAvailable = daily.filter((row) => row.complete).length > 0
    && daily.filter((row) => row.complete).every((row) => row.averageEggMassPerHenG != null);
  return NextResponse.json({
    window: { from: dayKey(fromDate), to: dayKey(toDate), days: daysInWindow },
    coverage: {
      layingFlocks: daily.reduce((sum, row) => sum + row.layingFlocks, 0),
      missingCollectionDays,
      completeDays: daily.filter((row) => row.complete).length,
      incompleteDays: daily.filter((row) => !row.complete && row.layingFlocks > 0).length,
    },
    summary: {
      eggsCollectedOnCompleteDays: completeEggs,
      saleableEggsOnCompleteDays: completeSaleableEggs,
      nonSaleableEggsOnCompleteDays: completeNonSaleableEggs,
      henDayProduction: completeLiveHens > 0 ? calculateHenDayProduction(completeEggs, completeLiveHens) : null,
      saleableRate: completeEggs > 0 ? safePercent(completeSaleableEggs, completeEggs) : null,
      feedKgRecorded: feedKg,
      recordedFeedCostMinor: feedCostMinor,
      feedKgPerDozenSaleableEggs: saleableDozens > 0 ? feedKg / saleableDozens : null,
      recordedFeedCostPerDozenMinor: saleableDozens > 0 ? feedCostMinor / saleableDozens : null,
      averageEggMassPerHenDayG: allWeightDaysAvailable && completeLiveHens > 0 ? completeEggMassG / completeLiveHens : null,
    },
    daily,
    byFlock,
    notes: [
      "Hen-day production and quality rates include complete laying-flock days only. An incomplete day is not treated as zero production.",
      "Per-flock hen-day and feed-per-dozen figures are blank for the selected window if that flock has missing collection days.",
      "Cumulative hen-housed output uses recorded total eggs divided by the original hens placed for that flock.",
      "Feed metrics use recorded FeedUsage rows only. Purchases, unallocated overhead and missing feed usage are not estimated.",
      "Egg mass per hen-day uses averageEggWeightG records and is blank where a complete laying day lacks a sample average.",
      "Eggs and stock marked withdrawalBlocked are treated as non-saleable.",
    ],
  });
}
