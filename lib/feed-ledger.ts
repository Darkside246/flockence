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
