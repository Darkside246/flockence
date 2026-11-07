import type { Prisma } from "@prisma/client";
import { kgToBags } from "./farm-engine.mjs";
import { loadFlockLedger } from "./flock-ledger";
import { feedStore } from "./feed-ledger";
import { ageOn } from "./flock-insights";

type Tx = Prisma.TransactionClient;
const DAY = 86400000;
const key = (d: Date) => d.toISOString().slice(0, 10);
/** Kilograms for reading: one decimal, with thousands separators. */
const kgText = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en", { maximumFractionDigits: 1 });

export type BriefingItem = { id: string; tone: "info" | "attention" | "urgent"; text: string; action?: { label: string; href: string }; basis?: string };

/**
 * What the owner should know first, in sentences, from the records alone. Every warning uses a farm setting (named in
 * the text) or a plain fact (a check not recorded today); nothing is invented, and missing data is said to be missing.
 */
export async function farmBriefing(tx: Tx, farmId: string, today: Date, operation: string | null) {
  const items: BriefingItem[] = [];
  const settings = Object.fromEntries((await tx.setting.findMany({ where: { farmId, key: { in: ["default_bag_kg", "feed_low_days"] } } })).map(s => [s.key, s.value]));
  const bagKg = Number(settings.default_bag_kg) > 0 ? Number(settings.default_bag_kg) : null;
  const lowDays = Number(settings.feed_low_days) > 0 ? Number(settings.feed_low_days) : 7;
  const currency = (await tx.farm.findUnique({ where: { id: farmId }, select: { currency: true } }))?.currency ?? "BBD";
  const money = (minor: number) => `${currency} ${(minor / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const weekAgo = new Date(today.getTime() - 6 * DAY);
  const flocks = await tx.batch.findMany({
    where: { farmId, status: "ACTIVE", ...(operation === "broilers" ? { NOT: { productionType: "LAYER" } } : operation === "layers" ? { productionType: "LAYER" } : {}) },
    select: { id: true, name: true, startDate: true, hatchDate: true, productionType: true, species: true, targetSlaughterAgeDays: true, expectedSlaughter: true },
    orderBy: { startDate: "asc" },
  });
  const ids = flocks.map(f => f.id);
  const [checksToday, lossesWeek, feedTotals, eggsToday, cases, treatments] = ids.length ? await Promise.all([
    tx.dailyFlockCheck.findMany({ where: { batchId: { in: ids }, date: today }, select: { batchId: true } }),
    tx.mortalityEvent.groupBy({ by: ["batchId"], where: { batchId: { in: ids }, date: { gte: weekAgo, lte: today } }, _sum: { quantity: true } }),
    tx.feedUsage.groupBy({ by: ["batchId"], where: { batchId: { in: ids } }, _sum: { quantityKg: true, costMinor: true } }),
    tx.eggCollection.findMany({ where: { batchId: { in: ids }, date: { gte: today, lt: new Date(today.getTime() + DAY) } }, select: { batchId: true, totalEggs: true, liveHens: true } }),
    tx.healthCase.findMany({ where: { farmId, status: { in: ["OPEN", "MONITORING"] } }, select: { title: true, nextReviewAt: true, status: true } }),
    tx.treatment.findMany({ where: { farmId, batchId: { in: ids }, withdrawalClearsAt: { gt: today } }, select: { batchId: true, productName: true, withdrawalClearsAt: true } }),
  ]) : [[], [], [], [], [], []];

  for (const f of flocks) {
    const layer = f.productionType === "LAYER" || String(f.species).toUpperCase() === "LAYER";
    const age = ageOn(f, today);
    const ledger = await loadFlockLedger(tx, f.id, today);
    const live = ledger?.balance.ok ? ledger.balance.live : null;
    let line = `${f.name} is ${age} day${age === 1 ? "" : "s"} old${live != null ? ` with ${live.toLocaleString()} live birds` : ""}.`;
    if (!layer && f.targetSlaughterAgeDays) {
      const left = f.targetSlaughterAgeDays - age;
      line += left > 0 ? ` Planned slaughter age ${f.targetSlaughterAgeDays} days: ${left} day${left === 1 ? "" : "s"} to go.` : left === 0 ? " It reaches its planned slaughter age today." : ` It is ${-left} day${left === -1 ? "" : "s"} past its planned slaughter age.`;
    }
    items.push({ id: "age-" + f.id, tone: !layer && f.targetSlaughterAgeDays && age > f.targetSlaughterAgeDays ? "attention" : "info", text: line, action: { label: "Open flock", href: "/batches" } });

    const lost = lossesWeek.find(l => l.batchId === f.id)?._sum.quantity ?? 0;
    if (lost > 0) items.push({ id: "loss-" + f.id, tone: "info", text: `${lost} bird${lost === 1 ? "" : "s"} lost in ${f.name} in the last 7 days.`, action: { label: "See losses", href: "/operations" } });

    const kg = Number(feedTotals.find(t => t.batchId === f.id)?._sum.quantityKg ?? 0);
    if (kg > 0) {
      const bags = kgToBags(kg, bagKg);
      const cost = feedTotals.find(t => t.batchId === f.id)?._sum.costMinor ?? 0;
      items.push({ id: "feed-" + f.id, tone: "info", text: `${f.name} has used ${bags != null ? `${bags} bag${bags === 1 ? "" : "s"} (${kgText(kg)} kg)` : `${kgText(kg)} kg`} of feed so far${cost ? `, costing ${money(cost)}` : ""}.`, basis: bags != null ? `Bags of ${bagKg} kg (the farm's usual bag size).` : "Set your usual bag size in Settings to see this in bags." });
    }

    if (!checksToday.some(c => c.batchId === f.id)) items.push({ id: "check-" + f.id, tone: "attention", text: `Today's daily check for ${f.name} has not been recorded.`, action: { label: "Record it", href: "/operations" } });

    if (layer) {
      const eggs = eggsToday.filter(e => e.batchId === f.id);
      if (eggs.length) {
        const n = eggs.reduce((s, e) => s + e.totalEggs, 0), hens = eggs.reduce((s, e) => s + e.liveHens, 0);
        items.push({ id: "eggs-" + f.id, tone: "info", text: `${n.toLocaleString()} eggs collected from ${f.name} today${hens ? ` (${Math.round((n / hens) * 1000) / 10}% of ${hens} hens)` : ""}.` });
      } else items.push({ id: "eggs-" + f.id, tone: "attention", text: `No egg collection recorded for ${f.name} today.`, action: { label: "Record eggs", href: "/layers" } });
    }
    for (const t of treatments.filter(x => x.batchId === f.id)) {
      items.push({ id: "wd-" + f.id + t.productName, tone: "attention", text: `${f.name}: ${t.productName} withdrawal runs until ${key(t.withdrawalClearsAt!)}. Do not sell ${layer ? "eggs" : "meat"} from this flock before then.`, action: { label: "Health", href: "/health" } });
    }
  }

  // feed in the store against recent use, warned at the farm's own level
  const store = await feedStore(tx, farmId);
  const recent = await tx.feedUsage.aggregate({ where: { batch: { farmId }, date: { gte: weekAgo, lte: today } }, _sum: { quantityKg: true } });
  const perDay = Number(recent._sum.quantityKg ?? 0) / 7;
  if (store.boughtKg > 0) {
    const days = perDay > 0 ? Math.floor(store.inStoreKg / perDay) : null;
    const bags = kgToBags(store.inStoreKg, bagKg);
    const low = days != null && days < lowDays;
    items.push({
      id: "feed-store", tone: low ? "urgent" : "info",
      text: `${kgText(store.inStoreKg)} kg of feed in the store${bags != null ? ` (about ${Math.round(bags)} bags)` : ""}${days != null ? `: about ${days} day${days === 1 ? "" : "s"} at this week's rate${low ? `, below your ${lowDays}-day warning level` : ""}` : ""}.`,
      action: low ? { label: "Record a feed purchase", href: "/finances#feed" } : undefined,
      basis: "Bought − put out + taken back, from your records. Change the warning level in Settings.",
    });
  }

  const overdue = cases.filter(c => c.nextReviewAt && c.nextReviewAt < today);
  if (overdue.length) items.push({ id: "cases", tone: "attention", text: `${overdue.length} health case${overdue.length === 1 ? " is" : "s are"} past the review date.`, action: { label: "Review", href: "/health" } });

  const lastFeed = await tx.feedPurchase.findFirst({ where: { farmId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { supplier: { select: { name: true } } } });
  if (lastFeed) items.push({ id: "last-feed", tone: "info", text: `Last feed bought: ${Number(lastFeed.quantityBags)} × ${Number(lastFeed.bagSizeKg)} kg ${lastFeed.feedType} on ${key(lastFeed.date)}${lastFeed.supplier ? ` from ${lastFeed.supplier.name}` : ""}.` });

  if (!flocks.length) items.push({ id: "none", tone: "info", text: "No active flocks. Start one under Flocks.", action: { label: "Start a flock", href: "/batches" } });
  const order = { urgent: 0, attention: 1, info: 2 };
  return items.sort((a, b) => order[a.tone] - order[b.tone]);
}
