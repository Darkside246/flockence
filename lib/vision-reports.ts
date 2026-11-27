import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { loadFlockLedger } from "@/lib/flock-ledger";
import { FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";
import { visionPens } from "@/lib/vision-pens";
import { eggCountsOn } from "@/lib/vision-egg-settings";
import {
  AREAS, AREA_LABELS, STATUS_LABELS, areaStatuses, dayParts, overallStatus, rankedActions, summarise,
  type Area, type AreaStatus,
} from "@/lib/vision-report-rules.mjs";

/**
 * Vision reports for the whole farm, one pen, one batch or one camera, over a chosen period (Vision Intelligence
 * phase 1b). A report is built from what Flockence already holds: inspections and their pictures, findings and their
 * reviews, the bird ledger, deaths, feed and eggs. It says what it was based on and what it could not see.
 */
export type ReportScope = { kind: "FARM" } | { kind: "PEN"; id: string } | { kind: "BATCH"; id: string } | { kind: "CAMERA"; name: string };
export type ReportPeriod = { from: Date; to: Date; label: string };

type Assessment = { pen?: { id: string; name: string }; source?: { kind?: string; name?: string }; signals?: { category?: string; state?: string }[]; capture?: unknown; eggs?: { floorEggs?: number | null; nestEggs?: number | null } };

const hourInFarm = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(d));
const visibleFrom = (notes: string | null) => { const m = notes?.match(/Birds visible: about (\d+)/); return m ? Number(m[1]) : null; };

export function periodFor(name: string, now = new Date(), custom?: { from?: string | null; to?: string | null }, batchStart?: Date | null): ReportPeriod | null {
  const day = 86_400_000;
  if (name === "24h") return { from: new Date(now.getTime() - day), to: now, label: "the last 24 hours" };
  if (name === "7d") return { from: new Date(now.getTime() - 7 * day), to: now, label: "the last 7 days" };
  if (name === "30d") return { from: new Date(now.getTime() - 30 * day), to: now, label: "the last 30 days" };
  if (name === "today") {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: FARM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const midnight = new Date(`${parts}T00:00:00-04:00`);   // Barbados has no daylight saving
    return { from: midnight, to: now, label: "today" };
  }
  if (name === "batch" && batchStart) return { from: batchStart, to: now, label: "the whole batch so far" };
  if (name === "custom" && custom?.from && custom?.to) {
    const from = new Date(custom.from + "T00:00:00-04:00"), to = new Date(custom.to + "T23:59:59-04:00");
    if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to && to.getTime() - from.getTime() <= 400 * day) {
      return { from, to: to > now ? now : to, label: `${custom.from} to ${custom.to}` };
    }
  }
  return null;
}

export async function buildVisionReport(scope: ReportScope, period: ReportPeriod) {
  const farmId = currentFarmId();
  const pens = await visionPens();
  const penName = (id: string) => pens.find((p) => p.id === id)?.name ?? "a pen";

  // Which pens and batches the scope covers.
  let penIds: string[] | null = null;
  let batchIds: string[] = [];
  let scopeLabel = "Whole farm";
  if (scope.kind === "PEN") {
    penIds = [scope.id];
    scopeLabel = `Pen ${penName(scope.id)}`;
    const active = await prisma.batch.findMany({ where: { farmId, status: "ACTIVE" }, select: { id: true, placementHouse: true } });
    batchIds = active.filter((b) => b.placementHouse?.trim().toLowerCase() === penName(scope.id).toLowerCase()).map((b) => b.id);
  } else if (scope.kind === "BATCH") {
    const batch = await prisma.batch.findFirst({ where: { id: scope.id, farmId }, select: { id: true, name: true, placementHouse: true } });
    if (!batch) return null;
    scopeLabel = `Batch ${batch.name}`;
    batchIds = [batch.id];
    // The pens this batch was in: where it was placed, and where its birds were moved (recorded transfers).
    const moves = await prisma.birdMovement.findMany({ where: { farmId, batchId: batch.id, type: "TRANSFER", voidedAt: null }, select: { toHouse: true } });
    const names = new Set([batch.placementHouse, ...moves.map((m) => m.toHouse)].filter(Boolean).map((n) => n!.trim().toLowerCase()));
    penIds = pens.filter((p) => names.has(p.name.toLowerCase())).map((p) => p.id);
  } else if (scope.kind === "CAMERA") {
    scopeLabel = `Camera ${scope.name}`;
  } else {
    batchIds = (await prisma.batch.findMany({ where: { farmId, status: "ACTIVE" }, select: { id: true } })).map((b) => b.id);
  }

  // Inspections in the period, kept to the scope.
  const rows = await prisma.healthObservation.findMany({
    where: { farmId, category: { startsWith: "VISION:" }, observedAt: { gte: period.from, lte: period.to } },
    orderBy: { observedAt: "desc" }, take: 2000,
    select: { id: true, observedAt: true, notes: true, imageUrl: true, batchId: true, visionAssessment: true },
  });
  const inspections = rows.filter((r) => {
    const a = (r.visionAssessment ?? {}) as Assessment;
    if (scope.kind === "CAMERA") return a.source?.kind === "CAMERA" && a.source.name === scope.name;
    if (scope.kind === "BATCH") return r.batchId === scope.id || (a.pen?.id != null && (penIds ?? []).includes(a.pen.id));
    if (scope.kind === "PEN") return a.pen?.id === scope.id;
    return true;
  });

  const findings = await prisma.visionFinding.findMany({
    where: {
      farmId, firstSeenAt: { lte: period.to }, lastSeenAt: { gte: period.from },
      ...(scope.kind === "PEN" ? { penId: scope.id } : scope.kind === "CAMERA" ? { cameraName: scope.name }
        : scope.kind === "BATCH" ? { OR: [{ batchId: scope.id }, ...(penIds?.length ? [{ penId: { in: penIds } }] : [])] } : {}),
    },
    orderBy: { lastSeenAt: "desc" }, take: 500,
  });

  // The same period just before, for "what changed".
  const span = period.to.getTime() - period.from.getTime();
  const before = await prisma.visionFinding.findMany({
    where: { farmId, firstSeenAt: { lte: period.from }, lastSeenAt: { gte: new Date(period.from.getTime() - span) },
      ...(scope.kind === "PEN" ? { penId: scope.id } : scope.kind === "CAMERA" ? { cameraName: scope.name } : {}) },
    select: { kind: true, state: true },
  });

  const parsedInspections = inspections.map((r) => ({ signals: ((r.visionAssessment ?? {}) as Assessment).signals ?? [], visibleBirds: visibleFrom(r.notes), eggsSeen: Boolean(((r.visionAssessment ?? {}) as Assessment).eggs) }));
  const areas = areaStatuses(findings, parsedInspections);
  const overall: AreaStatus = overallStatus(areas);
  const actions = rankedActions(findings);

  // Coverage: which sources gave pictures, when in the day, how many hours had any.
  const bySource = new Map<string, { count: number; last: Date; video: number }>();
  const hours = new Set<number>();
  const hourOfDay: number[] = [];
  for (const r of inspections) {
    const a = (r.visionAssessment ?? {}) as Assessment;
    const key = a.source?.kind === "CAMERA" ? `Camera ${a.source.name}` : "Uploaded photos";
    const line = bySource.get(key) ?? { count: 0, last: r.observedAt, video: 0 };
    line.count += 1;
    if (a.capture) line.video += 1;
    if (r.observedAt > line.last) line.last = r.observedAt;
    bySource.set(key, line);
    hours.add(Math.floor(r.observedAt.getTime() / 3_600_000));
    hourOfDay.push(hourInFarm(r.observedAt));
  }
  // Cameras that should cover this scope but sent nothing (from the camera-to-pen history).
  const links = await prisma.cameraPenLink.findMany({
    where: { farmId, ...(penIds ? { penId: { in: penIds } } : {}), fromAt: { lte: period.to }, OR: [{ toAt: null }, { toAt: { gte: period.from } }] },
    select: { cameraName: true },
  });
  const silent = [...new Set(links.map((l) => l.cameraName))].filter((name) => !bySource.has(`Camera ${name}`) && (scope.kind !== "CAMERA" || name === scope.name));

  // Records for the batches in scope: age, ledger live count, deaths, feed and eggs in the period.
  const batches = batchIds.length ? await prisma.batch.findMany({
    where: { id: { in: batchIds }, farmId },
    select: { id: true, name: true, startDate: true, hatchDate: true, productionType: true, species: true, initialChicks: true },
  }) : [];
  const flockLines = [];
  for (const b of batches) {
    const ledger = await prisma.$transaction((tx) => loadFlockLedger(tx, b.id)).catch(() => null);
    const [deaths, feed, eggs] = await Promise.all([
      prisma.mortalityEvent.aggregate({ where: { batchId: b.id, date: { gte: period.from, lte: period.to } }, _sum: { quantity: true } }),
      prisma.feedUsage.aggregate({ where: { batchId: b.id, date: { gte: period.from, lte: period.to } }, _sum: { quantityKg: true } }),
      prisma.eggCollection.aggregate({ where: { batchId: b.id, date: { gte: period.from, lte: period.to } }, _sum: { totalEggs: true, floorEggs: true } }),
    ]);
    const layer = b.productionType === "LAYER" || String(b.species).toUpperCase() === "LAYER";
    flockLines.push({
      id: b.id, name: b.name, kind: layer ? "layer" : "broiler",
      ageDays: Math.max(0, Math.floor((period.to.getTime() - (b.hatchDate ?? b.startDate).getTime()) / 86_400_000)),
      placed: b.initialChicks, liveRecorded: ledger?.balance.ok ? ledger.balance.live : null,
      deathsInPeriod: deaths._sum.quantity ?? 0, feedKgInPeriod: Math.round(Number(feed._sum.quantityKg ?? 0) * 10) / 10,
      eggsInPeriod: layer ? eggs._sum.totalEggs ?? 0 : null, floorEggsInPeriod: layer ? eggs._sum.floorEggs ?? 0 : null,
    });
  }
  const visibleMax = parsedInspections.reduce<number | null>((m, i) => (i.visibleBirds != null && (m == null || i.visibleBirds > m) ? i.visibleBirds : m), null);
  const liveTotal = flockLines.every((f) => f.liveRecorded != null) && flockLines.length ? flockLines.reduce((s, f) => s + (f.liveRecorded ?? 0), 0) : null;

  // Eggs (layers): shown only when the scope has a layer flock or floor-egg findings. Vision's egg counts are shown
  // beside the collection records only once the farm has switched them on (lib/vision-egg-settings.ts).
  const layers = flockLines.filter((f) => f.kind === "layer");
  const showEggs = layers.length > 0 || findings.some((f) => f.kind === "FLOOR_EGGS");
  const areaList = (AREAS as Area[]).filter((a) => a !== "EGGS" || showEggs);
  const countsOn = showEggs ? await eggCountsOn().catch(() => false) : false;
  const eggPictures = inspections.map((r) => ((r.visionAssessment ?? {}) as Assessment).eggs).filter((e): e is NonNullable<Assessment["eggs"]> => Boolean(e));
  const floorPictures = eggPictures.filter((e) => (e.floorEggs ?? 0) > 0).length;
  const mostFloor = eggPictures.reduce<number | null>((m, e) => (Number.isInteger(e.floorEggs) && (m == null || (e.floorEggs as number) > m) ? (e.floorEggs as number) : m), null);
  const eggs = showEggs ? {
    recordedEggs: layers.reduce((s, f) => s + (f.eggsInPeriod ?? 0), 0),
    recordedFloorEggs: layers.reduce((s, f) => s + (f.floorEggsInPeriod ?? 0), 0),
    picturesChecked: eggPictures.length,
    picturesWithFloorEggs: floorPictures,
    mostFloorEggsInOnePicture: countsOn ? mostFloor : null,
    countsOn,
    note: countsOn
      ? "Egg counts from pictures are what one camera could see, shown beside your collection records. Records are never changed by Vision."
      : "Vision says whether floor eggs were seen and where. Its egg counts stay hidden until you have checked them and switched them on. Records are never changed by Vision.",
  } : null;

  const changes = areaList.map((area) => {
    const kinds = { BIRDS: ["DEAD_OR_DOWN_BIRD", "HEALTH", "BEHAVIOUR"], THERMAL: ["THERMAL"], LITTER: ["LITTER"], FEED_WATER: ["FEED_WATER"], EQUIPMENT: ["EQUIPMENT"], POPULATION: ["POPULATION"], EGGS: ["FLOOR_EGGS"] }[area as Area];
    const now = findings.filter((f) => kinds.includes(f.kind) && f.state !== "DISMISSED").length;
    const then = before.filter((f) => kinds.includes(f.kind) && f.state !== "DISMISSED").length;
    return { area, label: AREA_LABELS[area as Area], now, before: then, trend: now > then ? "worse" : now < then ? "better" : "same" };
  }).filter((c) => c.now || c.before);

  const hoursInPeriod = Math.max(1, Math.round(span / 3_600_000));
  const limitations = [
    "Vision sees only what the cameras and photos show; birds out of view are not assessed.",
    inspections.length < 3 ? `Only ${inspections.length} inspection${inspections.length === 1 ? "" : "s"} in this period.` : "",
    silent.length ? `No pictures in this period from: ${silent.join(", ")}.` : "",
    ...areaList.filter((a) => areas[a].status === "INSUFFICIENT_DATA").map((a) => `${AREA_LABELS[a]}: not seen in this period.`),
    "Confidence levels are the model's own and have not yet been measured against labelled farm pictures.",
  ].filter(Boolean);

  return {
    scope: { ...scope, label: scopeLabel }, period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
    overall: { status: overall, label: STATUS_LABELS[overall] },
    summary: summarise({ scopeLabel, periodLabel: period.label, overall, actions, inspections: inspections.length, cameras: bySource.size, hoursCovered: hours.size, hoursInPeriod }),
    areas: areaList.map((a) => ({ area: a, label: AREA_LABELS[a], status: areas[a].status, statusLabel: STATUS_LABELS[areas[a].status], reasons: areas[a].reasons.slice(0, 5), fixed: areas[a].fixed })),
    eggs,
    actions,
    population: { liveRecorded: liveTotal, mostVisible: visibleMax, note: "Bird counts from pictures are estimates of what one camera can see, not the flock total. Official numbers are never changed by Vision." },
    flocks: flockLines,
    coverage: {
      inspections: inspections.length, hoursCovered: hours.size, hoursInPeriod,
      sources: [...bySource.entries()].map(([name, v]) => ({ name, inspections: v.count, videoSamples: v.video, lastAt: v.last.toISOString() })),
      silentCameras: silent, dayParts: dayParts(hourOfDay),
    },
    changes,
    evidence: findings.filter((f) => f.evidenceUrl && f.state !== "DISMISSED").slice(0, 6).map((f) => ({ title: f.title, at: f.lastSeenAt.toISOString(), url: f.evidenceUrl })),
    limitations,
  };
}
