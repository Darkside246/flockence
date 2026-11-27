import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { reconcileLiveBirdsFromSnapshot, FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";
import { contextText, eggLines, feedLines, orderSections, type ContextSection } from "@/lib/vision-context-rules.mjs";

/**
 * What Farm Vision is told about the farm, so it can judge a picture the way a person who knows the flock would. It is
 * built from the farm's own records, in sections (lib/vision-context-rules.mjs), with the ones that matter most for the
 * kind of check first:
 *  - the flock: type, breed, age, placed and live birds
 *  - deaths in the last day and week
 *  - feed put out (and grams per bird), water, the latest weight
 *  - the latest daily check and the sensors (temperature, humidity, ammonia, litter, panting)
 *  - open health cases and treatments still in withdrawal
 *  - eggs (layers)
 *  - the pen's size, stocking and equipment
 *  - open Vision findings for the pen
 * Only recorded facts; missing ones are left out. The same sections are shown on the Farm Vision page ("What Vision
 * already knows"), and sent formatted to Oriya's Operator Mode.
 *
 * The flock is the one chosen on the form; otherwise the active flock placed in this pen (Batch.placementHouse matches
 * the pen name); otherwise the farm's only active flock. With several active flocks and no match, no flock is assumed.
 */
export async function inspectionContext(input: { batchId: string | null; pen?: { id?: string; name: string } | null; category?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const farmId = currentFarmId();
  const dayAgo = new Date(now.getTime() - 86_400_000), weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  let batchId = input.batchId;
  let expectedLive: number | null = null;
  if (!batchId) {
    const active = await prisma.batch.findMany({ where: { farmId, status: "ACTIVE" }, select: { id: true, placementHouse: true } });
    const inPen = input.pen ? active.filter((b) => b.placementHouse && b.placementHouse.trim().toLowerCase() === input.pen!.name.trim().toLowerCase()) : [];
    batchId = inPen.length === 1 ? inPen[0].id : active.length === 1 ? active[0].id : null;
  }
  const sections: { key: string; lines: string[] }[] = [];
  const add = (key: string, lines: (string | false | null | undefined)[]) => sections.push({ key, lines: lines.filter((l): l is string => Boolean(l)) });
  const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

  const time = new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  add("TIME", [`local time at the farm ${time}`]);

  let live: number | null = null, weightKg: number | null = null, layer = false;
  if (batchId) {
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId },
      select: {
        name: true, initialChicks: true, startDate: true, hatchDate: true, productionType: true, species: true, breed: true, placementHouse: true,
        birdCounts: { where: { date: { lte: now } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1, select: { liveCount: true, date: true, createdAt: true } },
        mortalityEvents: { select: { quantity: true, date: true, createdAt: true } },
        slaughterEvents: { select: { sentQuantity: true, date: true, createdAt: true } },
        dailyFlockChecks: { orderBy: { date: "desc" }, take: 1, select: { date: true, waterLiters: true, avgWeightKg: true, temperatureC: true, humidityPercent: true, ammoniaPpm: true, litterCondition: true, pantingObserved: true, wingSpreadingObserved: true, notes: true } },
      },
    });
    if (batch) {
      const reconciled = reconcileLiveBirdsFromSnapshot(batch.initialChicks, batch.birdCounts[0] ?? null, [
        ...batch.mortalityEvents.map((m) => ({ quantity: m.quantity, date: m.date, createdAt: m.createdAt })),
        ...batch.slaughterEvents.map((e) => ({ quantity: e.sentQuantity, date: e.date, createdAt: e.createdAt })),
      ], now);
      live = typeof reconciled === "number" ? reconciled : null;
      expectedLive = live;
      layer = batch.productionType === "LAYER" || String(batch.species).toUpperCase() === "LAYER";
      const ageDays = Math.max(0, Math.floor((now.getTime() - (batch.hatchDate ?? batch.startDate).getTime()) / 86_400_000));
      add("FLOCK", [
        `${batch.name}: ${layer ? "layers" : "broilers"}${batch.breed ? `, ${batch.breed}` : ""}, about ${ageDays} days old`,
        `${batch.initialChicks} placed; ${live ?? "unknown"} live in the records`,
        batch.placementHouse && `housed in ${batch.placementHouse}`,
      ]);
      const lostDay = batch.mortalityEvents.filter((m) => m.date >= dayAgo).reduce((s, m) => s + m.quantity, 0);
      const lostWeek = batch.mortalityEvents.filter((m) => m.date >= weekAgo).reduce((s, m) => s + m.quantity, 0);
      add("MORTALITY", [`${lostDay} in the last 24 hours, ${lostWeek} in the last 7 days${live ? ` (${Math.round((1000 * lostWeek) / (live + lostWeek)) / 10}% of the flock this week)` : ""}`]);

      const [feedDay, feedWeek, weight, cases, treatments, eggs] = await Promise.all([
        prisma.feedUsage.aggregate({ where: { batchId, date: { gte: dayAgo, lte: now } }, _sum: { quantityKg: true } }),
        prisma.feedUsage.aggregate({ where: { batchId, date: { gte: weekAgo, lte: now } }, _sum: { quantityKg: true } }),
        prisma.weightRecord.findFirst({ where: { batchId, liveOrDressed: "LIVE" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { avgWeightKg: true, date: true } }),
        prisma.healthCase.findMany({ where: { farmId, status: { in: ["OPEN", "MONITORING"] }, OR: [{ batchId }, { batchId: null }] }, orderBy: { openedAt: "desc" }, take: 3, select: { title: true, severity: true, openedAt: true, suspectedCause: true } }),
        prisma.treatment.findMany({ where: { farmId, batchId, OR: [{ status: "ACTIVE" }, { withdrawalClearsAt: { gt: now } }] }, take: 3, select: { productName: true, status: true, withdrawalClearsAt: true } }),
        layer ? prisma.eggCollection.aggregate({ where: { batchId, date: { gte: dayAgo, lte: now } }, _sum: { totalEggs: true, floorEggs: true, crackedEggs: true }, _max: { liveHens: true } }) : null,
      ]);
      add("FEED", feedLines({ kg24h: n(feedDay._sum.quantityKg) ?? 0, kg7d: n(feedWeek._sum.quantityKg) ?? 0, live: live ?? 0 }));
      const check = batch.dailyFlockChecks[0];
      const water = n(check?.waterLiters);
      const feed24 = n(feedDay._sum.quantityKg) ?? 0;
      add("WATER", [water != null && `${water} litres on the latest daily check (${check!.date.toISOString().slice(0, 10)})${feed24 > 0 ? `, about ${Math.round((water / feed24) * 10) / 10} litres per kg of feed` : ""}`]);
      weightKg = weight ? Number(weight.avgWeightKg) : n(check?.avgWeightKg);
      add("WEIGHT", [weightKg != null && `${weightKg} kg average live weight (${(weight?.date ?? check?.date)!.toISOString().slice(0, 10)})`]);
      if (check) add("CONDITIONS", [
        `daily check ${check.date.toISOString().slice(0, 10)}: ${[
          check.temperatureC != null ? `${n(check.temperatureC)} °C` : "",
          check.humidityPercent != null ? `${n(check.humidityPercent)}% humidity` : "",
          check.ammoniaPpm != null ? `ammonia ${n(check.ammoniaPpm)} ppm` : "",
          check.litterCondition ? `litter ${check.litterCondition.toLowerCase()}` : "",
          check.pantingObserved ? "panting seen" : "",
          check.wingSpreadingObserved ? "wing spreading seen" : "",
        ].filter(Boolean).join(", ") || "no readings"}`,
      ]);
      add("HEALTH", [
        ...cases.map((c) => `open case: ${c.title} (${c.severity.toLowerCase()}, since ${c.openedAt.toISOString().slice(0, 10)})${c.suspectedCause ? `, suspected ${c.suspectedCause}` : ""}`),
        ...treatments.map((t) => `treatment: ${t.productName}${t.status === "ACTIVE" ? ", in progress" : ""}${t.withdrawalClearsAt && t.withdrawalClearsAt > now ? `, withdrawal until ${t.withdrawalClearsAt.toISOString().slice(0, 10)}` : ""}`),
      ]);
      if (eggs) add("EGGS", eggLines({ total: eggs._sum.totalEggs ?? 0, floor: eggs._sum.floorEggs ?? 0, cracked: eggs._sum.crackedEggs ?? 0, hens: eggs._max.liveHens || live || 0 }));
    }
  }

  // Thermometers and sensors: each one's latest reading from the last two hours.
  const readings = await prisma.thermometerReading.findMany({
    where: { farmId, readAt: { gte: new Date(now.getTime() - 2 * 3_600_000), lte: now } },
    orderBy: { readAt: "desc" }, take: 200, select: { sensor: true, readAt: true, temperatureC: true, humidityPercent: true },
  }).catch(() => []);
  const latest = new Map<string, (typeof readings)[number]>();
  for (const row of readings) if (!latest.has(row.sensor)) latest.set(row.sensor, row);
  const sensorLines = [...latest.values()].slice(0, 6).map((r) => `sensor ${r.sensor}: ${Number(r.temperatureC)} °C${r.humidityPercent != null ? `, ${Number(r.humidityPercent)}%` : ""} (${Math.max(0, Math.round((now.getTime() - r.readAt.getTime()) / 60_000))} min ago)`);
  const conditions = sections.find((s) => s.key === "CONDITIONS");
  if (conditions) conditions.lines.push(...sensorLines); else add("CONDITIONS", sensorLines);

  // The pen: its recorded size and equipment, and Vision findings still open there.
  if (input.pen) {
    const row = input.pen.id ? await prisma.setting.findFirst({ where: { id: input.pen.id, farmId }, select: { value: true } }) : null;
    let saved: Record<string, unknown> = {};
    try { saved = JSON.parse(row?.value ?? "{}"); } catch { /* none */ }
    const num = (k: string) => Math.max(0, Number(saved[k]) || 0);
    const area = num("lengthM") * num("widthM");
    const kit = [num("feederPans") && `${num("feederPans")} feeder pans`, num("nipples") && `${num("nipples")} nipples`, num("bellDrinkers") && `${num("bellDrinkers")} bell drinkers`, num("heatSources") && `${num("heatSources")} heaters`, num("fans") && `${num("fans")} fans`].filter(Boolean);
    add("PEN", [
      `${input.pen.name}${area ? `: ${num("lengthM")} × ${num("widthM")} m (${Math.round(area * 10) / 10} m²)` : " (size not recorded)"}`,
      area && live && weightKg ? `about ${Math.round((live * weightKg / area) * 10) / 10} kg/m² stocking` : null,
      kit.length ? `recorded equipment: ${kit.join(", ")}` : null,
    ]);
    if (input.pen.id) {
      const open = await prisma.visionFinding.findMany({ where: { farmId, penId: input.pen.id, state: { in: ["OBSERVED", "SUSPECTED", "REQUIRES_INSPECTION", "INCONCLUSIVE", "CONFIRMED"] } }, orderBy: { lastSeenAt: "desc" }, take: 3, select: { title: true, occurrences: true, state: true } });
      add("FINDINGS", open.map((f) => `${f.title}${f.occurrences > 1 ? ` (seen ${f.occurrences} times)` : ""}${f.state === "CONFIRMED" ? ", confirmed by the farm" : ""}`));
    }
  }

  const ordered: ContextSection[] = orderSections(sections, input.category ?? "OTHER");
  return { batchId, sections: ordered, text: contextText(ordered), expectedLive };
}
