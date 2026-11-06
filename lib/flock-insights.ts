import type { Prisma } from "@prisma/client";
import { birdBalance, temperatureExposure, unusualChange, waterToFeed, type BirdEvent } from "./farm-engine.mjs";
import { loadFlockLedger } from "./flock-ledger";

type Tx = Prisma.TransactionClient;
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The last two weeks of a flock, per day: live birds, feed, water and losses, each per bird where the measurement exists;
 * then today's figures against the flock's own recent days. Readings that do not exist are reported missing, never filled in.
 */
export async function flockInsights(tx: Tx, farmId: string, batchId: string, today: Date, opts: { heatAboveC?: number } = {}) {
  const ledger = await loadFlockLedger(tx, batchId);
  if (!ledger || !ledger.balance.ok) return { ok: false as const, error: ledger?.balance.error ?? "Flock not found." };
  const from = new Date(today); from.setUTCDate(from.getUTCDate() - 14);
  const [feed, checks, losses, sent, moves, counts] = await Promise.all([
    tx.feedUsage.findMany({ where: { batchId, date: { gte: from, lte: today } }, select: { date: true, quantityKg: true } }),
    tx.dailyFlockCheck.findMany({ where: { batchId, date: { gte: from, lte: today } }, select: { date: true, waterLiters: true, feedKg: true } }),
    tx.mortalityEvent.findMany({ where: { batchId }, select: { date: true, quantity: true, kind: true, createdAt: true } }),
    tx.slaughterEvent.findMany({ where: { batchId }, select: { date: true, sentQuantity: true, createdAt: true } }),
    tx.birdMovement.findMany({ where: { batchId, voidedAt: null, type: "ADDITION" }, select: { date: true, quantity: true, createdAt: true } }),
    tx.birdCount.findMany({ where: { batchId, NOT: { note: { startsWith: "Calculated after" } } }, select: { date: true, liveCount: true, createdAt: true, note: true } }),
  ]);
  const events: BirdEvent[] = [
    ...losses.map(l => ({ type: l.kind === "CULLED" ? "CULL" : l.kind === "MISSING" ? "MISSING" : "MORTALITY", quantity: l.quantity, date: l.date, createdAt: l.createdAt })),
    ...sent.map(s => ({ type: "SLAUGHTER", quantity: s.sentQuantity, date: s.date, createdAt: s.createdAt })),
    ...moves.map(m => ({ type: "ADDITION", quantity: m.quantity, date: m.date, createdAt: m.createdAt })),
  ];
  const headCounts = counts.filter(c => c.note !== "Initial count").map(c => ({ count: c.liveCount, date: c.date, createdAt: c.createdAt }));

  const days: { date: string; live: number; feedKg: number | null; waterL: number | null; losses: number; feedPerBirdG: number | null; waterPerBirdMl: number | null; waterToFeed: number | null }[] = [];
  for (let d = new Date(from); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = key(d);
    const live = birdBalance({ initialBirds: ledger.batch.initialChicks, events, headCounts, asOf: new Date(d) }).live ?? 0;
    const f = feed.filter(r => key(r.date) === k);
    const feedKg = f.length ? Math.round(f.reduce((s, r) => s + Number(r.quantityKg) * 1000, 0)) / 1000 : null;
    const c = checks.find(r => key(r.date) === k);
    const waterL = c?.waterLiters != null ? Number(c.waterLiters) : null;
    const lost = losses.filter(l => key(l.date) === k).reduce((s, l) => s + l.quantity, 0);
    days.push({
      date: k, live, feedKg, waterL, losses: lost,
      feedPerBirdG: feedKg != null && live > 0 ? Math.round((feedKg / live) * 100000) / 100 : null,
      waterPerBirdMl: waterL != null && live > 0 ? Math.round((waterL / live) * 100000) / 100 : null,
      waterToFeed: waterToFeed(waterL, feedKg),
    });
  }
  const last = days.at(-1)!;
  const earlier = days.slice(0, -1);
  const checksToRun: [string, keyof typeof last, string][] = [["Feed per bird", "feedPerBirdG", " g"], ["Water per bird", "waterPerBirdMl", " ml"], ["Birds lost", "losses", ""]];
  const alerts = checksToRun.map(([label, field, unit]) => {
    const value = last[field];
    if (typeof value !== "number") return null;
    const r = unusualChange(label, value, earlier.map(d => d[field]).filter((v): v is number => typeof v === "number"), { unit, minHistory: 7 });
    return r.ok && r.unusual ? { label, explanation: r.explanation, value, baseline: r.baseline } : null;
  }).filter(Boolean);

  const since = new Date(Date.now() - 24 * 3600000);
  const readings = await tx.thermometerReading.findMany({ where: { farmId, readAt: { gte: since } }, select: { sensor: true, readAt: true, temperatureC: true }, orderBy: { readAt: "asc" } });
  const sensors = [...new Set(readings.map(r => r.sensor))];
  const high = opts.heatAboveC ?? 32;
  const heat = sensors.map(sensor => ({ sensor, ...temperatureExposure(readings.filter(r => r.sensor === sensor).map(r => ({ at: r.readAt, c: Number(r.temperatureC) })), { high }) }));

  const missing: string[] = [];
  if (last.feedKg == null) missing.push("No feed recorded for today.");
  if (last.waterL == null) missing.push("No water reading for today.");
  if (!sensors.length) missing.push("No house temperature readings in the last 24 hours.");
  return { ok: true as const, liveBirds: ledger.balance.live, days, alerts, heat, heatThresholdC: high, missing };
}
