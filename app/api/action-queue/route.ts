import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { calculateLifecycle } from "@/lib/lifecycle";
import { getFarmWeather } from "@/lib/weather";
import { getWithdrawalBlockers } from "@/lib/withdrawal";

type Action = {
  id: string;
  priority: "URGENT" | "HIGH" | "MODERATE" | "LOW";
  type: string;
  title: string;
  detail: string;
  batchId?: string | null;
  dueAt?: string | null;
  href: string;
};

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [batches, tasks, orders, weatherResult, storageLocations] = await Promise.all([
    prisma.batch.findMany({
      where: { farmId: currentFarmId(), status: "ACTIVE" },
      include: {
        weights: { where: { liveOrDressed: "LIVE" }, orderBy: { date: "desc" }, take: 2 },
        birdCounts: { orderBy: { date: "desc" }, take: 1 },
        mortalityEvents: true,
        dailyFlockChecks: { where: { date: { gte: dayStart, lt: dayEnd } }, orderBy: { date: "desc" }, take: 1 },
        treatments: { where: { OR: [{ status: "ACTIVE", withdrawalClearsAt: null }, { withdrawalClearsAt: { gt: today } }] }, orderBy: { withdrawalClearsAt: "asc" } },
      },
      orderBy: { startDate: "asc" },
    }),
    prisma.farmTask.findMany({ where: { farmId: currentFarmId(), completedAt: null }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }], take: 30 }),
    prisma.sale.findMany({ where: { farmId: currentFarmId(), orderStatus: { in: ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } }, include: { items: true }, orderBy: { date: "asc" }, take: 30 }),
    getFarmWeather().catch((error) => ({ configured: false as const, reason: error instanceof Error ? error.message : "Weather unavailable." })),
    prisma.storageLocation.findMany({ where: { farmId: currentFarmId(), active: true }, include: { temperatureLogs: { orderBy: { date: "desc" }, take: 1 } } }),
  ]);

  const actions: Action[] = [];
  for (const batch of batches) {
    const blockers = await getWithdrawalBlockers(batch.id, today);
    if (blockers.length) {
      const first = blockers[0];
      actions.push({ id: "withdrawal:" + batch.id, priority: "URGENT", type: "WITHDRAWAL", title: batch.name + " is under withdrawal hold", detail: first.productName + (first.clearsAt ? " clears " + new Date(first.clearsAt).toLocaleString("en-BB") : " has no clearance date recorded"), batchId: batch.id, href: "/health" });
    }
    const [latest, previous] = batch.weights;
    const lifecycle = calculateLifecycle({ hatchDate: batch.hatchDate, purchaseDate: batch.purchaseDate, startDate: batch.startDate, targetAgeDays: batch.targetSlaughterAgeDays, decisionMode: batch.slaughterDecisionMode, targetLiveWeightKg: batch.targetLiveWeightKg ? Number(batch.targetLiveWeightKg) : null, latestLiveWeightKg: latest ? Number(latest.avgWeightKg) : null, latestWeightDate: latest?.date, previousLiveWeightKg: previous ? Number(previous.avgWeightKg) : null, previousWeightDate: previous?.date });
    if (lifecycle.recommendation !== "CONTINUE" && !blockers.length) actions.push({ id: "harvest:" + batch.id, priority: lifecycle.weightReady ? "HIGH" : "MODERATE", type: "HARVEST", title: batch.name + " is entering harvest window", detail: lifecycle.weightReady ? "Target live weight reached." : "Age target reached or harvest review is due.", batchId: batch.id, dueAt: lifecycle.ageTargetDate.toISOString(), href: "/operations" });
    const daily = batch.dailyFlockChecks[0];
    if (!daily) actions.push({ id: "daily-check:" + batch.id, priority: "HIGH", type: "DAILY_CHECK", title: "Complete today's flock check for " + batch.name, detail: "Record live birds, feed, water and house conditions once.", batchId: batch.id, href: "/operations" });
    if (daily?.pantingObserved || daily?.wingSpreadingObserved) actions.push({ id: "heat-sign:" + batch.id, priority: "URGENT", type: "HEAT", title: "Heat/welfare signs reported in " + batch.name, detail: "Check house temperature, RH, airflow and water access immediately.", batchId: batch.id, href: "/operations" });
  }

  if (weatherResult.configured && weatherResult.weather.current.heatRisk === "HIGH") actions.push({ id: "weather:heat", priority: "HIGH", type: "WEATHER", title: "Outside heat watch", detail: weatherResult.weather.heatAdvice, href: "/" });
  if (weatherResult.configured && weatherResult.weather.forecast.some(x => x.heatRisk === "HIGH")) actions.push({ id: "weather:forecast", priority: "MODERATE", type: "WEATHER", title: "Heat risk expected in the forecast", detail: "Review ventilation, water access and house monitoring before the hottest period.", href: "/" });

  for (const task of tasks) actions.push({ id: "task:" + task.id, priority: task.priority as Action["priority"], type: "TASK", title: task.title, detail: task.batchId ? "Batch task" : "Farm task", batchId: task.batchId, dueAt: task.dueAt?.toISOString() ?? null, href: "/operations" });
  for (const order of orders) actions.push({ id: "order:" + order.id, priority: order.orderStatus === "OUT_FOR_DELIVERY" ? "HIGH" : "MODERATE", type: "ORDER", title: "Order needs attention", detail: (order.customerName || "Customer") + " · " + order.orderStatus + " · " + order.items.map(item => String(item.quantity) + " × " + item.description).join(", "), href: "/finances#orders" });

  for (const location of storageLocations) {
    const latest = location.temperatureLogs[0];
    if (!latest) {
      actions.push({ id: "storage:" + location.id, priority: "MODERATE", type: "COLD_CHAIN", title: "Check " + location.name + " temperature", detail: "No temperature reading has been recorded yet.", href: "/inventory" });
    } else if (location.temperatureMaxC != null && Number(latest.temperatureC) > Number(location.temperatureMaxC)) {
      actions.push({ id: "storage-hot:" + location.id, priority: "HIGH", type: "COLD_CHAIN", title: location.name + " is above its set maximum", detail: "Recorded " + Number(latest.temperatureC).toFixed(1) + "°C against " + Number(location.temperatureMaxC).toFixed(1) + "°C maximum.", href: "/inventory" });
    }
  }

  const priorityRank: Record<Action["priority"], number> = { URGENT: 4, HIGH: 3, MODERATE: 2, LOW: 1 };
  actions.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
  return NextResponse.json({ generatedAt: today.toISOString(), actions: actions.slice(0, 40), openActionCount: actions.length });
}