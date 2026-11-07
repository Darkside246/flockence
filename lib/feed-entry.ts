import type { Prisma } from "@prisma/client";
import { feedToKg } from "./farm-engine.mjs";
import { bagSizeFor } from "./feed-catalogue";

type Tx = Prisma.TransactionClient;
export const FEED_UNITS = ["BAG", "KG", "G", "LB", "MEASURE"] as const;

/**
 * Turn feed as the farmer counted it ("1 bag", "3 scoops", "20 lb") into kilograms, using the feed's bag size or the
 * farm's measure. Returns what was entered, too, so the record keeps both.
 */
export async function convertFeed(tx: Tx, farmId: string, p: { amount: unknown; unit: unknown; feedProductId?: string | null; measureId?: string | null }) {
  const unit = String(p.unit || "KG").toUpperCase();
  if (!(FEED_UNITS as readonly string[]).includes(unit)) return { ok: false as const, error: "Choose bags, kg, grams, pounds or one of your measures." };
  let bagKg: number | null = null, measureKg: number | null = null, measureName = "measure", enteredUnit = unit;
  if (unit === "BAG") bagKg = (await bagSizeFor(tx, farmId, p.feedProductId))?.kg ?? null;
  if (unit === "MEASURE") {
    const m = p.measureId ? await tx.feedMeasure.findFirst({ where: { id: p.measureId, farmId } }) : null;
    if (!m) return { ok: false as const, error: "Choose which measure you used." };
    measureKg = m.kgPerUnit == null ? null : Number(m.kgPerUnit);
    measureName = m.name.toLowerCase();
    enteredUnit = "MEASURE:" + m.id;
  }
  const r = feedToKg(p.amount as number, unit, { bagKg, measureKg, measureName });
  if (!r.ok) return { ok: false as const, error: r.error! };
  return { ok: true as const, kg: r.kg!, basis: r.basis!, enteredQuantity: Number(p.amount), enteredUnit, bagKg };
}
