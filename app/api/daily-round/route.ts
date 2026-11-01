import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { calendarDateInTimeZone, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;

  await ensureFarm();

  const dateText = calendarDateInTimeZone(new Date());
  const date = dateText ? parseCalendarDate(dateText) : null;
  if (!date) return NextResponse.json({ error: "Could not determine the farm calendar date." }, { status: 500 });

  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  const [batches, checks, mortality, slaughter, treatments] = await Promise.all([
    prisma.batch.findMany({
      where: { farmId: FARM_ID, status: "ACTIVE" },
      select: { id: true, name: true, productionType: true, species: true, initialChicks: true },
      orderBy: { name: "asc" },
    }),
    prisma.dailyFlockCheck.findMany({
      where: { farmId: FARM_ID, date },
      select: {
        batchId: true,
        liveCount: true,
        feedKg: true,
        waterLiters: true,
        avgWeightKg: true,
        temperatureC: true,
        humidityPercent: true,
        ammoniaPpm: true,
        litterCondition: true,
        pantingObserved: true,
        wingSpreadingObserved: true,
        notes: true,
      },
    }),
    prisma.mortalityEvent.aggregate({
      where: { batch: { farmId: FARM_ID }, date },
      _sum: { quantity: true },
      _count: { id: true },
    }),
    prisma.slaughterEvent.aggregate({
      where: { batch: { farmId: FARM_ID }, date },
      _sum: { sentQuantity: true, slaughtered: true, condemned: true },
      _count: { id: true },
    }),
    prisma.treatment.findMany({
      where: {
        farmId: FARM_ID,
        startedAt: { lt: nextDate },
        OR: [
          { status: "ACTIVE", withdrawalClearsAt: null },
          { withdrawalClearsAt: { gt: date } },
        ],
      },
      select: { batchId: true, productName: true, withdrawalClearsAt: true },
    }),
  ]);

  const checkByBatch = new Map(checks.map(row => [row.batchId, row]));
  const withdrawalByBatch = new Map<string, string[]>();
  for (const treatment of treatments) {
    if (!treatment.batchId) continue;
    const current = withdrawalByBatch.get(treatment.batchId) ?? [];
    current.push(treatment.productName);
    withdrawalByBatch.set(treatment.batchId, current);
  }

  const flockRows = batches.map(batch => {
    const check = checkByBatch.get(batch.id);
    const liveCount = check ? Number(check.liveCount) : null;
    const feedKg = num(check?.feedKg);
    const waterLiters = num(check?.waterLiters);
    return {
      id: batch.id,
      name: batch.name,
      productionType: batch.productionType,
      species: batch.species,
      checkedToday: Boolean(check),
      liveCount,
      feedKg,
      waterLiters,
      waterToFeedRatio: feedKg && feedKg > 0 && waterLiters != null ? waterLiters / feedKg : null,
      feedKgPerLiveBird: feedKg != null && liveCount != null && liveCount > 0 ? feedKg / liveCount : null,
      waterLitersPerLiveBird: waterLiters != null && liveCount != null && liveCount > 0 ? waterLiters / liveCount : null,
      avgWeightKg: num(check?.avgWeightKg),
      temperatureC: num(check?.temperatureC),
      humidityPercent: num(check?.humidityPercent),
      ammoniaPpm: num(check?.ammoniaPpm),
      litterCondition: check?.litterCondition ?? null,
      pantingObserved: Boolean(check?.pantingObserved),
      wingSpreadingObserved: Boolean(check?.wingSpreadingObserved),
      notes: check?.notes ?? null,
      withdrawalHold: (withdrawalByBatch.get(batch.id) ?? []).length > 0,
      withdrawalProducts: withdrawalByBatch.get(batch.id) ?? [],
    };
  });

  const recorded = flockRows.filter(row => row.checkedToday).length;
  const totalFeedKg = flockRows.reduce((sum, row) => sum + (row.feedKg ?? 0), 0);
  const totalWaterLiters = flockRows.reduce((sum, row) => sum + (row.waterLiters ?? 0), 0);
  const liveBirdsWithChecks = flockRows.reduce((sum, row) => sum + (row.liveCount ?? 0), 0);

  return NextResponse.json({
    date: dateText,
    coverage: { activeFlocks: batches.length, recordedFlocks: recorded, missingFlocks: Math.max(0, batches.length - recorded) },
    totals: {
      liveBirdsWithChecks,
      feedKg: totalFeedKg,
      waterLiters: totalWaterLiters,
      waterToFeedRatio: totalFeedKg > 0 ? totalWaterLiters / totalFeedKg : null,
      mortalityCount: mortality._sum.quantity ?? 0,
      mortalityRecords: mortality._count.id,
      sentToProcessor: slaughter._sum.sentQuantity ?? 0,
      slaughtered: slaughter._sum.slaughtered ?? 0,
      condemned: slaughter._sum.condemned ?? 0,
      slaughterRecords: slaughter._count.id,
      heatWelfareFlags: flockRows.filter(row => row.pantingObserved || row.wingSpreadingObserved).length,
      withdrawalHolds: treatments.length,
    },
    flocks: flockRows,
  });
}
