import type { Prisma } from "@prisma/client";
import { birdBalance, broilerTargetTemp, growthForecast, meterUsage, tankUsage, temperatureExposure, unusualChange, waterToFeed, type BirdEvent } from "./farm-engine.mjs";
import { loadFlockLedger } from "./flock-ledger";
import { flockFeed } from "./feed-ledger";

type Tx = Prisma.TransactionClient;
const key = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const DAY = 86400000;

/** Age in days on a date, from the hatch date when known, else the placement date. */
export function ageOn(batch: { hatchDate: Date | null; startDate: Date }, date: Date) {
  const born = batch.hatchDate ?? batch.startDate;
  return Math.floor((new Date(key(date) + "T00:00:00Z").getTime() - new Date(key(born) + "T00:00:00Z").getTime()) / DAY);
}

/** This flock's own live weighings turned into a forecast at a given age (and when it reaches its target weight). */
export async function flockGrowth(tx: Tx, batchId: string, atAgeDays?: number) {
  const batch = await tx.batch.findFirst({ where: { id: batchId }, select: { hatchDate: true, startDate: true, targetLiveWeightKg: true } });
  if (!batch) return null;
  const weights = await tx.weightRecord.findMany({ where: { batchId, liveOrDressed: "LIVE" }, select: { date: true, avgWeightKg: true } });
  return growthForecast(weights.map(w => ({ ageDays: ageOn(batch, w.date), kg: Number(w.avgWeightKg) })), {
    atAgeDays: atAgeDays ?? null, targetKg: batch.targetLiveWeightKg == null ? null : Number(batch.targetLiveWeightKg),
  });
}

/**
 * The last two weeks of a flock, per day: live birds, feed put out and eaten, water and losses, each per bird where the
 * measurement exists; then today's figures against the flock's own recent days, the house temperature against the
 * target for the birds' age, and where the flock's weight is heading. Missing readings are reported, never filled in.
 */
export async function flockInsights(tx: Tx, farmId: string, batchId: string, today: Date, opts: { heatAboveC?: number; bandC?: number } = {}) {
  const ledger = await loadFlockLedger(tx, batchId);
  if (!ledger || !ledger.balance.ok) return { ok: false as const, error: ledger?.balance.error ?? "Flock not found." };
  const batch = await tx.batch.findFirst({ where: { id: batchId }, select: { hatchDate: true, startDate: true, productionType: true, species: true, targetSlaughterAgeDays: true, placementHouse: true } });
  const from = new Date(today.getTime() - 14 * DAY);
  const [feed, checks, losses, sent, moves, counts, waterRows] = await Promise.all([
    flockFeed(tx, batchId, from, today),
    tx.dailyFlockCheck.findMany({ where: { batchId, date: { gte: from, lte: today } }, select: { date: true, waterLiters: true } }),
    tx.mortalityEvent.findMany({ where: { batchId }, select: { date: true, quantity: true, kind: true, createdAt: true } }),
    tx.slaughterEvent.findMany({ where: { batchId }, select: { date: true, sentQuantity: true, createdAt: true } }),
    tx.birdMovement.findMany({ where: { batchId, voidedAt: null, type: "ADDITION" }, select: { date: true, quantity: true, createdAt: true } }),
    tx.birdCount.findMany({ where: { batchId, NOT: { note: { startsWith: "Calculated after" } } }, select: { date: true, liveCount: true, createdAt: true, note: true } }),
    tx.waterReading.findMany({ where: { batchId, readAt: { gte: new Date(from.getTime() - 3 * DAY) } }, orderBy: { readAt: "asc" } }),
  ]);
  const events: BirdEvent[] = [
    ...losses.map(l => ({ type: l.kind === "CULLED" ? "CULL" : l.kind === "MISSING" ? "MISSING" : "MORTALITY", quantity: l.quantity, date: l.date, createdAt: l.createdAt })),
    ...sent.map(s => ({ type: "SLAUGHTER", quantity: s.sentQuantity, date: s.date, createdAt: s.createdAt })),
    ...moves.map(m => ({ type: "ADDITION", quantity: m.quantity, date: m.date, createdAt: m.createdAt })),
  ];
  const headCounts = counts.filter(c => c.note !== "Initial count").map(c => ({ count: c.liveCount, date: c.date, createdAt: c.createdAt }));

  // water measured from meters and tanks, credited to the day of the later reading
  const measuredWater = new Map<string, number>();
  for (const source of [...new Set(waterRows.map(w => `${w.kind}::${w.source}`))]) {
    const rs = waterRows.filter(w => `${w.kind}::${w.source}` === source);
    const intervals = rs[0].kind === "TANK"
      ? tankUsage(rs.map(r => ({ at: r.readAt, levelL: Number(r.readingL), addedL: r.addedL == null ? 0 : Number(r.addedL), otherUseL: r.otherUseL == null ? 0 : Number(r.otherUseL) })))
      : meterUsage(rs.map(r => ({ at: r.readAt, reading: Number(r.readingL) })));
    for (const i of intervals) if (i.litres != null) measuredWater.set(key(i.to), (measuredWater.get(key(i.to)) ?? 0) + i.litres);
  }

  const feedByDay = new Map(feed.days.map(d => [d.date, d]));
  const days: { date: string; live: number; feedKg: number | null; eatenKg: number | null; waterL: number | null; waterSource: "READING" | "CHECK" | null; losses: number; feedPerBirdG: number | null; eatenPerBirdG: number | null; waterPerBirdMl: number | null; waterToFeed: number | null }[] = [];
  for (let t = from.getTime(); t <= today.getTime(); t += DAY) {
    const d = new Date(t), k = key(d);
    const live = birdBalance({ initialBirds: ledger.batch.initialChicks, events, headCounts, asOf: d }).live ?? 0;
    const f = feedByDay.get(k);
    const check = checks.find(r => key(r.date) === k);
    const fromCheck = check?.waterLiters != null ? Number(check.waterLiters) : null;
    const fromReading = measuredWater.get(k) ?? null;
    const waterL = fromCheck ?? fromReading;
    const per = (v: number | null, scale: number) => (v != null && live > 0 ? Math.round((v / live) * scale * 100) / 100 : null);
    days.push({
      date: k, live, feedKg: f?.issuedKg ?? null, eatenKg: f?.eatenKg ?? null, waterL, waterSource: fromCheck != null ? "CHECK" : fromReading != null ? "READING" : null,
      losses: losses.filter(l => key(l.date) === k).reduce((s, l) => s + l.quantity, 0),
      feedPerBirdG: per(f?.issuedKg ?? null, 1000), eatenPerBirdG: per(f?.eatenKg ?? null, 1000), waterPerBirdMl: per(waterL, 1000),
      waterToFeed: waterToFeed(waterL, f?.eatenKg ?? f?.issuedKg ?? null),
    });
  }
  const last = days.at(-1)!;
  const earlier = days.slice(0, -1);
  const useEaten = earlier.filter(d => d.eatenPerBirdG != null).length >= 7 && last.eatenPerBirdG != null;
  const checksToRun: [string, keyof typeof last, string][] = [[useEaten ? "Feed eaten per bird" : "Feed put out per bird", useEaten ? "eatenPerBirdG" : "feedPerBirdG", " g"], ["Water per bird", "waterPerBirdMl", " ml"], ["Birds lost", "losses", ""]];
  const alerts = checksToRun.map(([label, field, unit]) => {
    const value = last[field];
    if (typeof value !== "number") return null;
    const r = unusualChange(label, value, earlier.map(d => d[field]).filter((v): v is number => typeof v === "number"), { unit, minHistory: 7 });
    return r.ok && r.unusual ? { label, explanation: r.explanation, value, baseline: r.baseline } : null;
  }).filter(Boolean);

  // heat: the target for the birds' age (broilers), with a band either side, and a fixed heat-stress line
  const isBroiler = batch?.productionType !== "LAYER" && String(batch?.species ?? "").toUpperCase() !== "LAYER";
  const age = batch ? ageOn(batch, today) : null;
  const target = isBroiler && age != null ? broilerTargetTemp(age) : null;
  const band = opts.bandC ?? 3;
  const high = opts.heatAboveC ?? 32;
  const readings = await tx.thermometerReading.findMany({ where: { farmId, readAt: { gte: new Date(Date.now() - DAY) } }, select: { sensor: true, readAt: true, temperatureC: true }, orderBy: { readAt: "asc" } });
  const sensors = [...new Set(readings.map(r => r.sensor))];
  const heat = sensors.map(sensor => {
    const rs = readings.filter(r => r.sensor === sensor).map(r => ({ at: r.readAt, c: Number(r.temperatureC) }));
    const stress = temperatureExposure(rs, { high });
    const vsTarget = target ? temperatureExposure(rs, { low: target.targetC - band, high: target.targetC + band }) : null;
    return { sensor, ...stress, hoursAboveTarget: vsTarget?.hoursAbove ?? null, hoursBelowTarget: vsTarget?.hoursBelow ?? null };
  });

  const growth = isBroiler ? await flockGrowth(tx, batchId, batch?.targetSlaughterAgeDays ?? undefined) : null;

  const missing: string[] = [];
  if (last.feedKg == null) missing.push("No feed recorded for today.");
  else if (last.eatenKg == null) missing.push("Feed was put out today, but the leftover was not weighed, so how much was eaten is not known.");
  if (last.waterL == null) missing.push("No water reading for today.");
  if (!sensors.length) missing.push("No house temperature readings in the last 24 hours.");
  return {
    ok: true as const, liveBirds: ledger.balance.live, ageDays: age, days, alerts, heat, heatThresholdC: high,
    targetTemp: target ? { ...target, bandC: band, ageDays: age } : null,
    feed: { eatenKg: feed.eatenKg, measuredDays: feed.measuredDays, issuedKg: feed.issuedKg, spillageKg: feed.spillageKg },
    growth, missing,
  };
}
