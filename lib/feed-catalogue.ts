import type { Prisma } from "@prisma/client";
import { rememberCreated } from "./farm-scope";

type Tx = Prisma.TransactionClient;

/**
 * The built-in starting list (from the manufacturers' Barbados poultry catalogues). It is copied into a farm's own
 * catalogue the first time the catalogue is opened, and from then on the farm owns it: rename, add, switch off.
 * https://rmco.com/pinnaclefeeds/animal-feeding-program/poultry-feeds-broilers/
 * https://rmco.com/pinnaclefeeds/animal-feeding-program/poultry-feeds-layers/
 * https://www.superfeedsmill.com/products
 */
export const STARTER_FEEDS: Record<string, string[]> = {
  "Pinnacle Feeds": ["Broiler Starter", "Broiler Grower", "Broiler Finisher", "Chick Starter", "Growing Ration", "Super Layer 18%", "Cage Layer 17%"],
  "Super Feeds": [
    "Broiler Pre-Starter", "Broiler Starter", "Broiler Starter (crumble)", "Broiler Grower", "Broiler Grower (crumble)", "Broiler Grower (pellet)",
    "Broiler Finisher", "Broiler Finisher (pellet)", "Pullet (Chick) Starter", "Pullet Grower Ration", "Pullet Developer", "Pre-Layer 15Wks - 5%", "Pre-Peak Layer",
    "Layer 50% - 32Wks", "Layer 32-44Wks", "Layer 44-55Wks", "Layer 55 Wks Plus", "Layer 17%", "Super Layer 18%",
  ],
};

/** "Brand · Name" is how feed was named on purchases before the catalogue existed. */
export const feedLabel = (p: { brand: string; name: string }) => (p.brand ? `${p.brand} · ${p.name}` : p.name);
export function splitFeedLabel(label: string) {
  const i = label.indexOf(" · ");
  return i > 0 ? { brand: label.slice(0, i).trim(), name: label.slice(i + 3).trim() } : { brand: "", name: label.trim() };
}

/**
 * Make sure the farm has its catalogue: the starter list, plus every feed name already used on a purchase or in feed use
 * (so nothing in the history is left without a product), and link those older records to their product. Runs once;
 * after that it only adds names that appear on new free-text entries. Never deletes or renames.
 */
export async function ensureFeedCatalogue(tx: Tx, farmId: string) {
  const existing = await tx.feedProduct.findMany({ where: { farmId }, select: { id: true, brand: true, name: true } });
  const key = (b: string, n: string) => `${b.toLowerCase()}::${n.toLowerCase()}`;
  const have = new Map(existing.map(p => [key(p.brand, p.name), p.id]));
  const wanted: { brand: string; name: string; sortOrder: number }[] = [];
  if (existing.length === 0) {
    let order = 0;
    for (const [brand, names] of Object.entries(STARTER_FEEDS)) for (const name of names) wanted.push({ brand, name, sortOrder: order++ });
  }
  const [purchaseNames, usageNames] = await Promise.all([
    tx.feedPurchase.findMany({ where: { farmId }, distinct: ["feedType"], select: { feedType: true } }),
    tx.feedUsage.findMany({ where: { batch: { farmId } }, distinct: ["feedType"], select: { feedType: true } }),
  ]);
  for (const label of new Set([...purchaseNames, ...usageNames].map(r => r.feedType).filter(Boolean))) {
    const { brand, name } = splitFeedLabel(label);
    if (name) wanted.push({ brand, name, sortOrder: 1000 });
  }
  // skipDuplicates: two first-time openings at once (two phones, two tabs) cannot clash
  const missing = wanted.filter((w, i) => !have.has(key(w.brand, w.name)) && wanted.findIndex(x => key(x.brand, x.name) === key(w.brand, w.name)) === i);
  if (missing.length) {
    await tx.feedProduct.createMany({ data: missing.map(w => ({ farmId, brand: w.brand, name: w.name, sortOrder: w.sortOrder })), skipDuplicates: true });
    // read back through the farm-scoped client, so these ids are this farm's; mark them so links made in this same
    // transaction (old purchases → product) pass the farm check, which cannot see uncommitted rows
    for (const p of await tx.feedProduct.findMany({ where: { farmId }, select: { id: true, brand: true, name: true } })) { have.set(key(p.brand, p.name), p.id); rememberCreated("FeedProduct", p.id); }
  }
  // link older purchases and feed use to their product by name (only rows not yet linked)
  const unlinked = await tx.feedPurchase.findMany({ where: { farmId, feedProductId: null }, select: { id: true, feedType: true } });
  for (const r of unlinked) {
    const { brand, name } = splitFeedLabel(r.feedType);
    const id = have.get(key(brand, name));
    if (id) await tx.feedPurchase.update({ where: { id: r.id }, data: { feedProductId: id } });
  }
  return have.size;
}

/** The bag size to use for "bags": the product's own, else the farm default, else the last bag size bought of it. */
export async function bagSizeFor(tx: Tx, farmId: string, feedProductId?: string | null) {
  if (feedProductId) {
    const p = await tx.feedProduct.findFirst({ where: { id: feedProductId, farmId }, select: { defaultBagKg: true } });
    if (p?.defaultBagKg != null) return { kg: Number(p.defaultBagKg), from: "the feed's bag size" };
  }
  const farmDefault = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: "default_bag_kg" } } });
  if (farmDefault && Number(farmDefault.value) > 0) return { kg: Number(farmDefault.value), from: "the farm's usual bag size" };
  const last = await tx.feedPurchase.findFirst({ where: { farmId, ...(feedProductId ? { feedProductId } : {}) }, orderBy: { date: "desc" }, select: { bagSizeKg: true } });
  if (last) return { kg: Number(last.bagSizeKg), from: "the last bag size bought" };
  return null;
}

/** Cost per kg of a feed from its latest purchase (falling back to any feed's latest purchase), in minor units. */
export async function feedCostPerKg(tx: Tx, farmId: string, feedProductId?: string | null, onDate?: Date) {
  const where = { farmId, ...(onDate ? { date: { lte: onDate } } : {}) };
  const row = (feedProductId ? await tx.feedPurchase.findFirst({ where: { ...where, feedProductId }, orderBy: { date: "desc" } }) : null)
    ?? await tx.feedPurchase.findFirst({ where, orderBy: { date: "desc" } });
  if (!row || Number(row.bagSizeKg) <= 0) return null;
  return { perKgMinor: row.unitCostMinor / Number(row.bagSizeKg), feedType: row.feedType, feedProductId: row.feedProductId };
}
