import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calculateLifecycle } from "@/lib/lifecycle";
import { getFarmWeather } from "@/lib/weather";
import { authorizeAuraIntegration } from "@/lib/aura-integration";

export async function GET(request: Request) {
  if (!authorizeAuraIntegration(request)) return NextResponse.json({ error: "INVALID_INTEGRATION_TOKEN" }, { status: 401 });
  await ensureFarm();

  const [farm, batches, healthCases, tasks, orders, weatherResult] = await Promise.all([
    prisma.farm.findUnique({ where: { id: currentFarmId() }, select: { id: true, name: true, currency: true } }),
    prisma.batch.findMany({
      where: { farmId: currentFarmId(), status: "ACTIVE" },
      include: {
        weights: { where: { liveOrDressed: "LIVE" }, orderBy: { date: "desc" }, take: 2 },
        birdCounts: { orderBy: { date: "desc" }, take: 1 },
        mortalityEvents: true,
      },
      orderBy: { startDate: "asc" },
    }),
    prisma.healthCase.findMany({
      where: { farmId: currentFarmId(), status: { in: ["OPEN", "MONITORING"] } },
      select: { id: true, caseNumber: true, title: true, severity: true, affectedCount: true, movementRestricted: true, isolationRecommended: true },
      orderBy: [{ severity: "desc" }, { openedAt: "asc" }],
      take: 20,
    }),
    prisma.farmTask.findMany({
      where: { farmId: currentFarmId(), completedAt: null },
      select: { id: true, title: true, dueAt: true, priority: true, batchId: true },
      orderBy: [{ dueAt: "asc" }],
      take: 20,
    }),
    prisma.sale.findMany({
      where: { farmId: currentFarmId(), orderStatus: { in: ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } },
      select: { id: true, customerName: true, totalMinor: true, orderStatus: true, fulfillmentMethod: true, deliveryAddress: true, items: { select: { description: true, quantity: true } } },
      orderBy: { date: "asc" },
      take: 20,
    }),
    getFarmWeather().catch((error) => ({ configured: false as const, reason: error instanceof Error ? error.message : "Weather unavailable." })),
  ]);

  const flock = batches.map((batch) => {
    const [latest, previous] = batch.weights;
    const liveCount = batch.birdCounts[0]?.liveCount ?? Math.max(0, batch.initialChicks - batch.mortalityEvents.reduce((sum, item) => sum + item.quantity, 0));
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
    return {
      id: batch.id,
      name: batch.name,
      liveCount,
      ageDays: lifecycle.ageDays,
      ageWeeks: lifecycle.ageWeeks,
      ageTargetDate: lifecycle.ageTargetDate,
      weightKg: latest ? Number(latest.avgWeightKg) : null,
      adgKgPerDay: lifecycle.adgKgPerDay,
      weightReady: lifecycle.weightReady,
      harvestRecommendation: lifecycle.recommendation,
      beyondSixWeeks: lifecycle.isBeyondSixWeeks,
      targetLiveWeightKg: batch.targetLiveWeightKg ? Number(batch.targetLiveWeightKg) : null,
    };
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    farm: farm ?? { id: currentFarmId(), name: "Farm", currency: "BBD" },
    flock,
    healthExceptions: healthCases,
    openTasks: tasks,
    openOrders: orders,
    weather: weatherResult.configured ? weatherResult.weather : null,
    weatherUnavailableReason: weatherResult.configured ? null : weatherResult.reason,
    rules: [
      "Weather is advisory. House temperature, humidity, airflow and bird observations remain the operational truth.",
      "Harvest recommendations are planning signals, not automatic slaughter commands.",
      "Health cases marked for isolation or movement restriction require human review.",
    ],
  });
}
