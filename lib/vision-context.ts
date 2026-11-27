import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { reconcileLiveBirdsFromSnapshot, FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";

/**
 * What Farm Vision is told about the farm, so it can judge a picture the way a person who knows the flock would:
 * which flock is in the pen, its age and recorded live birds, deaths in the last day and week, today's daily check
 * (temperature, humidity, litter, panting) and the local time of day. Only recorded facts; missing ones are left out.
 *
 * The flock is the one chosen on the form; otherwise the active flock placed in this pen (Batch.placementHouse matches
 * the pen name); otherwise the farm's only active flock. With several active flocks and no match, no flock is assumed.
 */
export async function inspectionContext(input: { batchId: string | null; pen?: { name: string } | null; now?: Date }) {
  const now = input.now ?? new Date();
  const farmId = currentFarmId();
  let batchId = input.batchId;
  let expectedLive: number | null = null;
  if (!batchId) {
    const active = await prisma.batch.findMany({ where: { farmId, status: "ACTIVE" }, select: { id: true, placementHouse: true } });
    const inPen = input.pen ? active.filter((b) => b.placementHouse && b.placementHouse.trim().toLowerCase() === input.pen!.name.trim().toLowerCase()) : [];
    batchId = inPen.length === 1 ? inPen[0].id : active.length === 1 ? active[0].id : null;
  }
  const parts: string[] = [];
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  parts.push(`Local time at the farm: ${time}.`);
  if (input.pen) parts.push(`Camera pen: ${input.pen.name}.`);
  if (batchId) {
    const dayAgo = new Date(now.getTime() - 86_400_000), weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId },
      select: {
        name: true, initialChicks: true, startDate: true, hatchDate: true, productionType: true, species: true, breed: true,
        birdCounts: { where: { date: { lte: now } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1, select: { liveCount: true, date: true, createdAt: true } },
        mortalityEvents: { select: { quantity: true, date: true, createdAt: true } },
        slaughterEvents: { select: { sentQuantity: true, date: true, createdAt: true } },
        dailyFlockChecks: { orderBy: { date: "desc" }, take: 1, select: { date: true, temperatureC: true, humidityPercent: true, ammoniaPpm: true, litterCondition: true, pantingObserved: true, wingSpreadingObserved: true } },
      },
    });
    if (batch) {
      const live = reconcileLiveBirdsFromSnapshot(batch.initialChicks, batch.birdCounts[0] ?? null, [
        ...batch.mortalityEvents.map((m) => ({ quantity: m.quantity, date: m.date, createdAt: m.createdAt })),
        ...batch.slaughterEvents.map((e) => ({ quantity: e.sentQuantity, date: e.date, createdAt: e.createdAt })),
      ], now);
      expectedLive = typeof live === "number" ? live : null;
      const ageDays = Math.max(0, Math.floor((now.getTime() - (batch.hatchDate ?? batch.startDate).getTime()) / 86_400_000));
      const lostDay = batch.mortalityEvents.filter((m) => m.date >= dayAgo).reduce((s, m) => s + m.quantity, 0);
      const lostWeek = batch.mortalityEvents.filter((m) => m.date >= weekAgo).reduce((s, m) => s + m.quantity, 0);
      const kind = batch.productionType === "LAYER" || String(batch.species).toUpperCase() === "LAYER" ? "layer" : "broiler";
      parts.push(`Flock ${batch.name} (${kind}${batch.breed ? ", " + batch.breed : ""}), about ${ageDays} days old; ${batch.initialChicks} placed; recorded live birds ${live ?? "unknown"}; deaths in the last 24 hours ${lostDay}, last 7 days ${lostWeek}.`);
      const check = batch.dailyFlockChecks[0];
      if (check) {
        const facts = [
          check.temperatureC != null ? `house ${Number(check.temperatureC)} °C` : "",
          check.humidityPercent != null ? `${Number(check.humidityPercent)}% humidity` : "",
          check.ammoniaPpm != null ? `ammonia ${Number(check.ammoniaPpm)} ppm` : "",
          check.litterCondition ? `litter ${check.litterCondition.toLowerCase()}` : "",
          check.pantingObserved ? "panting seen" : "",
          check.wingSpreadingObserved ? "wing spreading seen" : "",
        ].filter(Boolean);
        if (facts.length) parts.push(`Latest daily check (${check.date.toISOString().slice(0, 10)}): ${facts.join(", ")}.`);
      }
    }
  }
  // Thermometers and sensors: each one's latest reading from the last two hours.
  const readings = await prisma.thermometerReading.findMany({
    where: { farmId, readAt: { gte: new Date(now.getTime() - 2 * 3_600_000), lte: now } },
    orderBy: { readAt: "desc" }, take: 200, select: { sensor: true, readAt: true, temperatureC: true, humidityPercent: true },
  }).catch(() => []);
  const latest = new Map<string, (typeof readings)[number]>();
  for (const row of readings) if (!latest.has(row.sensor)) latest.set(row.sensor, row);
  if (latest.size) {
    const list = [...latest.values()].slice(0, 6).map((r) => `${r.sensor} ${Number(r.temperatureC)} °C${r.humidityPercent != null ? ` / ${Number(r.humidityPercent)}%` : ""} (${Math.max(0, Math.round((now.getTime() - r.readAt.getTime()) / 60_000))} min ago)`);
    parts.push(`Sensor readings: ${list.join("; ")}.`);
  }
  return { batchId, text: parts.join(" "), expectedLive };
}
