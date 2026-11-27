import type { Prisma } from "@prisma/client";
import { OUTPUT_KIND, processingYield, sumKg } from "./farm-engine.mjs";

type Tx = Prisma.TransactionClient;
export const DISPOSALS = ["BURIED", "BURNED", "COMPOSTED", "RENDERED", "COLLECTED"] as const;

/**
 * Everything that left the farm as something other than sold or stocked food, over a period, from the records already
 * kept: dead birds and how they were disposed of, processing by-products and waste (and what was done with them),
 * damaged eggs, spilt feed, manure and litter, and stock written off. Partial weights show an unaccounted balance.
 */
export async function wasteSummary(tx: Tx, farmId: string, from: Date, to: Date) {
  const range = { gte: from, lt: new Date(to.getTime() + 86400000) };  // to the end of the last day
  const [deaths, outputs, slaughters, eggs, feed, manure, writeOffs] = await Promise.all([
    tx.mortalityEvent.findMany({ where: { batch: { farmId }, date: range }, select: { kind: true, quantity: true, disposal: true } }),
    tx.processingOutput.findMany({ where: { batch: { farmId }, slaughterEvent: { date: range } }, select: { slaughterEventId: true, category: true, productName: true, weightKg: true, quantity: true, unit: true, status: true } }),
    tx.slaughterEvent.findMany({ where: { batch: { farmId }, date: range }, select: { id: true, date: true, sentQuantity: true, condemned: true, liveWeightKg: true, dressedWeightKg: true, batch: { select: { name: true } } } }),
    tx.eggCollection.findMany({ where: { farmId, date: range }, select: { totalEggs: true, crackedEggs: true, brokenEggs: true, rejectedEggs: true, dirtyEggs: true, floorEggs: true } }),
    tx.feedUsage.findMany({ where: { batch: { farmId }, date: range }, select: { spillageKg: true } }),
    tx.manureRecord.findMany({ where: { farmId, date: range }, select: { material: true, quantity: true, unit: true, disposition: true } }),
    tx.inventoryMovement.findMany({ where: { farmId, date: range, movementType: { in: ["DAMAGE", "DISPOSAL"] } }, select: { movementType: true, quantity: true, unit: true, weightKg: true } }),
  ]);

  const deadBirds: Record<string, Record<string, number>> = {};
  for (const d of deaths) {
    const k = d.kind ?? "DIED", disp = d.disposal ?? "NOT_RECORDED";
    deadBirds[k] = deadBirds[k] ?? {};
    deadBirds[k][disp] = (deadBirds[k][disp] ?? 0) + d.quantity;
  }

  const processing = slaughters.map(s => {
    const rows = outputs.filter(o => o.slaughterEventId === s.id);
    // No processing pack yet: the dressed weight from the slaughter is the food recorded; nothing else is assumed.
    const kinds = rows.length ? rows.map(o => ({ kind: OUTPUT_KIND[o.category] ?? "BYPRODUCT", kg: o.weightKg == null ? 0 : Number(o.weightKg) }))
      : s.dressedWeightKg != null ? [{ kind: "EDIBLE" as const, kg: Number(s.dressedWeightKg) }] : [];
    const unweighed = rows.filter(o => o.weightKg == null).length;
    const y = !kinds.length ? { edibleKg: 0, byproductKg: 0, wasteKg: 0, recordedKg: 0, yieldPercent: null, unaccountedKg: null } : processingYield({ liveKg: s.liveWeightKg == null ? null : Number(s.liveWeightKg), outputs: kinds });
    const handling: Record<string, number> = {};
    for (const o of rows.filter(r => (OUTPUT_KIND[r.category] ?? "BYPRODUCT") !== "EDIBLE")) handling[o.status] = sumKg([handling[o.status] ?? 0, o.weightKg == null ? 0 : Number(o.weightKg)]);
    return { outputsRecorded: rows.length > 0, dressedOnly: !rows.length && s.dressedWeightKg != null, slaughterEventId: s.id, flock: s.batch.name, date: s.date.toISOString().slice(0, 10), birds: s.sentQuantity, condemnedBirds: s.condemned, ...y, unweighedOutputs: unweighed, byproductHandlingKg: handling };
  });

  const sum = (k: keyof (typeof eggs)[number]) => eggs.reduce((t, e) => t + Number(e[k] ?? 0), 0);
  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    deadBirds,
    processing,
    eggs: { collected: sum("totalEggs"), cracked: sum("crackedEggs"), broken: sum("brokenEggs"), rejected: sum("rejectedEggs"), dirty: sum("dirtyEggs"), floor: sum("floorEggs") },
    feedSpiltKg: sumKg(feed.map(f => (f.spillageKg == null ? null : Number(f.spillageKg)))),
    manure: manure.map(m => ({ material: m.material, quantity: Number(m.quantity), unit: m.unit, disposition: m.disposition })),
    stockWrittenOff: writeOffs.map(w => ({ type: w.movementType, quantity: Number(w.quantity), unit: w.unit, weightKg: w.weightKg == null ? null : Number(w.weightKg) })),
  };
}
