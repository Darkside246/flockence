import type { Prisma } from "@prisma/client";
import { feederConsumption, sumKg } from "./farm-engine.mjs";

type Tx = Prisma.TransactionClient;
const key = (d: Date) => d.toISOString().slice(0, 10);
const kg = (v: unknown) => (v == null ? null : Number(v));

/**
 * Feed in the store, from the records alone: bought − put out + taken back. There is no separate "feed remaining" to type.
 * Without a counted opening stock this is the stock bought through Flockence; say so on screen.
 */
export async function feedStore(tx: Tx, farmId: string) {
  const [bought, usage] = await Promise.all([
    tx.feedPurchase.findMany({ where: { farmId }, select: { bagSizeKg: true, quantityBags: true } }),
    tx.feedUsage.findMany({ where: { batch: { farmId } }, select: { quantityKg: true, returnedKg: true, spillageKg: true } }),
  ]);
  const boughtKg = sumKg(bought.map(b => Number(b.bagSizeKg) * Number(b.quantityBags)));
  const issuedKg = sumKg(usage.map(u => kg(u.quantityKg)));
  const returnedKg = sumKg(usage.map(u => kg(u.returnedKg)));
  const spiltKg = sumKg(usage.map(u => kg(u.spillageKg)));
  return { boughtKg, issuedKg, returnedKg, spiltKg, inStoreKg: sumKg([boughtKg, -issuedKg, returnedKg]), status: "CALCULATED" as const, basis: "Feed bought − feed put out + feed taken back to the store." };
}

/** Per day for one flock: put out, left, spilt, returned and eaten (only where the leftover was weighed). */
export async function flockFeed(tx: Tx, batchId: string, from?: Date, to?: Date) {
  const rows = await tx.feedUsage.findMany({
    where: { batchId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    select: { date: true, quantityKg: true, leftoverKg: true, spillageKg: true, returnedKg: true }, orderBy: { date: "asc" },
  });
  const byDay = new Map<string, { issued: number[]; left: (number | null)[]; spill: number[]; ret: number[] }>();
  for (const r of rows) {
    const k = key(r.date);
    const d = byDay.get(k) ?? { issued: [], left: [], spill: [], ret: [] };
    d.issued.push(Number(r.quantityKg)); d.left.push(kg(r.leftoverKg)); d.spill.push(kg(r.spillageKg) ?? 0); d.ret.push(kg(r.returnedKg) ?? 0);
    byDay.set(k, d);
  }
  // a day counts as weighed only if every feed entry that day has its leftover weighed
  return feederConsumption([...byDay.entries()].map(([date, d]) => ({
    date, issuedKg: sumKg(d.issued), spillageKg: sumKg(d.spill), returnedKg: sumKg(d.ret),
    leftoverKg: d.left.every(v => v != null) ? sumKg(d.left) : null,
  })));
}

/**
 * One flock's feed so far: kilograms, bags (at the farm's bag size), cost, per bird placed, per bird per day (from the
 * actual live birds each day) and feed conversion when two live weighings allow it. Missing inputs give null, not 0.
 */
export async function flockFeedSummary(tx: Tx, farmId: string, batchId: string) {
  const { birdBalance, dailyPopulation, birdDays, feedConversion, kgToBags, perBirdDay } = await import("./farm-engine.mjs");
  const { loadFlockLedger } = await import("./flock-ledger");
  const [usage, batch, bag, weights] = await Promise.all([
    tx.feedUsage.findMany({ where: { batchId }, select: { date: true, quantityKg: true, costMinor: true } , orderBy: { date: "asc" } }),
    tx.batch.findFirst({ where: { id: batchId, farmId }, select: { initialChicks: true, startDate: true } }),
    tx.setting.findUnique({ where: { farmId_key: { farmId, key: "default_bag_kg" } } }),
    tx.weightRecord.findMany({ where: { batchId, liveOrDressed: "LIVE" }, orderBy: { date: "asc" }, select: { date: true, avgWeightKg: true } }),
  ]);
  if (!batch) return null;
  const totalKg = sumKg(usage.map(u => Number(u.quantityKg)));
  const costMinor = usage.reduce((s, u) => s + u.costMinor, 0);
  const bagKg = Number(bag?.value) > 0 ? Number(bag!.value) : null;
  let kgPerBirdDay: number | null = null, fcr: { value: number; method: string } | null = null, fcrNote: string | null = null;
  const ledger = await loadFlockLedger(tx, batchId);
  if (usage.length && ledger) {
    // bird-days over the days feed was recorded, from the actual live birds each day
    const events = (await tx.mortalityEvent.findMany({ where: { batchId }, select: { quantity: true, date: true, createdAt: true, kind: true } })).map(e => ({ type: e.kind === "CULLED" ? "CULL" : e.kind === "MISSING" ? "MISSING" : "MORTALITY", quantity: e.quantity, date: e.date, createdAt: e.createdAt }));
    const sent = (await tx.slaughterEvent.findMany({ where: { batchId }, select: { sentQuantity: true, date: true, createdAt: true } })).map(e => ({ type: "SLAUGHTER", quantity: e.sentQuantity, date: e.date, createdAt: e.createdAt }));
    const added = (await tx.birdMovement.findMany({ where: { batchId, type: "ADDITION", voidedAt: null }, select: { quantity: true, date: true, createdAt: true } })).map(e => ({ type: "ADDITION", quantity: e.quantity, date: e.date, createdAt: e.createdAt }));
    const pop = dailyPopulation({ initialBirds: batch.initialChicks, events: [...events, ...sent, ...added], from: usage[0].date, to: usage.at(-1)!.date });
    kgPerBirdDay = perBirdDay(totalKg, birdDays(pop));
    if (weights.length >= 2) {
      const first = weights[0], last = weights.at(-1)!;
      const live = (d: Date) => birdBalance({ initialBirds: batch.initialChicks, events: [...events, ...sent, ...added], asOf: d }).live ?? null;
      const between = sumKg(usage.filter(u => u.date > first.date && u.date <= last.date).map(u => Number(u.quantityKg)));
      const f = feedConversion({ feedKg: between, startBirds: live(first.date), startAvgKg: Number(first.avgWeightKg), endBirds: live(last.date), endAvgKg: Number(last.avgWeightKg) });
      if (f.ok) fcr = { value: f.fcr!, method: `${f.method}, between the weighings on ${first.date.toISOString().slice(0, 10)} and ${last.date.toISOString().slice(0, 10)}. Feed recorded as put out.` };
      else fcrNote = f.note ?? null;
    } else fcrNote = "Feed conversion needs birds weighed on at least two days.";
  }
  return {
    totalKg, bags: kgToBags(totalKg, bagKg), bagKg, costMinor, entries: usage.length,
    perBirdPlacedKg: batch.initialChicks > 0 && usage.length ? Math.round((totalKg / batch.initialChicks) * 1000) / 1000 : null,
    kgPerBirdDay, fcr, fcrNote,
  };
}
