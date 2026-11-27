// Usage (throwaway database only): DATABASE_URL=postgresql://...:54340/flockence_ux node scripts/seed-test-volume.mjs
// Fills the THROWAWAY test database with about a year of realistic records so load times can be measured.
import { PrismaClient } from "@prisma/client";
if (!/54340\/flockence_ux$/.test(process.env.DATABASE_URL || "")) throw new Error("Only for the throwaway test database");
const db = new PrismaClient();
const farmId = "farm-ux";
const day = n => new Date(Date.UTC(2026, 10, 7) - n * 86400000);
const flocks = [];
// 8 finished broiler flocks over the year, 2 active broiler flocks, 1 layer flock
for (let i = 0; i < 10; i++) {
  const start = 350 - i * 35;
  flocks.push({ id: "vol-b" + i, name: "Batch " + String(i + 1).padStart(2, "0"), start, days: i < 8 ? 42 : start, chicks: 300, layer: false, active: i >= 8 });
}
flocks.push({ id: "vol-l1", name: "Layers 2026", start: 300, days: 300, chicks: 200, layer: true, active: true });
const pick = (n) => Math.floor(Math.random() * n);
for (const f of flocks) {
  await db.batch.upsert({ where: { id: f.id }, update: {}, create: { id: f.id, farmId, name: f.name, startDate: day(f.start), status: f.active ? "ACTIVE" : "SLAUGHTERED", productionType: f.layer ? "LAYER" : "BROILER", layerStage: f.layer ? "LAYING" : null, species: "CHICKEN", initialChicks: f.chicks, chickCostMinor: 290, targetSlaughterAgeDays: 42, targetLiveWeightKg: f.layer ? null : 2.5 } });
  await db.birdCount.create({ data: { batchId: f.id, date: day(f.start), liveCount: f.chicks, note: "Initial count" } });
  const checks = [], feed = [], deaths = [], weights = [], eggs = [];
  for (let d = 0; d < f.days; d++) {
    const date = day(f.start - d);
    if (date > day(0)) break;
    checks.push({ farmId, batchId: f.id, date, liveCount: f.chicks - Math.floor(d / 6), feedKg: f.layer ? 22 : Math.min(60, 2 + d * 1.4), waterLiters: f.layer ? 45 : Math.min(120, 5 + d * 3), temperatureC: 28 + pick(4) });
    feed.push({ batchId: f.id, date, feedType: "Super Feeds · Broiler Grower", quantityKg: f.layer ? 22 : Math.min(60, 2 + d * 1.4), costMinor: 4000 });
    if (d % 6 === 3) deaths.push({ batchId: f.id, date, quantity: 1, kind: "DIED" });
    if (!f.layer && d % 7 === 0) weights.push({ batchId: f.id, date, scope: "SAMPLE", quantity: 10, avgWeightKg: 0.05 + d * 0.055, liveOrDressed: "LIVE" });
    if (f.layer && d > 140) eggs.push({ farmId, batchId: f.id, date, liveHens: 190, totalEggs: 170, saleableEggs: 165, crackedEggs: 3, rejectedEggs: 2 });
  }
  await db.dailyFlockCheck.createMany({ data: checks, skipDuplicates: true });
  await db.feedUsage.createMany({ data: feed });
  await db.mortalityEvent.createMany({ data: deaths });
  await db.weightRecord.createMany({ data: weights });
  if (eggs.length) await db.eggCollection.createMany({ data: eggs });
  if (!f.layer && !f.active) await db.slaughterEvent.create({ data: { batchId: f.id, date: day(f.start - 42), sentQuantity: 290, slaughtered: 290, slaughterCostMinor: 58000, dressedWeightKg: 520, liveWeightKg: 720, dressedDefinition: "CARCASS" } });
}
const bought = [];
for (let w = 0; w < 52; w++) bought.push({ farmId, date: day(w * 7), feedType: "Super Feeds · Broiler Grower", bagSizeKg: 30, quantityBags: 20, unitCostMinor: 9000 });
await db.feedPurchase.createMany({ data: bought });
const sales = [], expenses = [];
for (let s = 0; s < 120; s++) sales.push({ farmId, date: day(s * 3), totalMinor: 30000 + pick(20000), amountPaidMinor: 30000, recordStatus: "ACTUAL" });
for (let e = 0; e < 200; e++) expenses.push({ farmId, date: day(e * 2), category: "Utilities", description: "Power", amountMinor: 5000 + pick(5000), recordStatus: "ACTUAL" });
try { await db.sale.createMany({ data: sales }); } catch (e) { console.log("sales skipped:", e.message.split("\n").at(-1)); }
try { await db.expense.createMany({ data: expenses }); } catch (e) { console.log("expenses skipped:", e.message.split("\n").at(-1)); }
const counts = await Promise.all([db.dailyFlockCheck.count(), db.feedUsage.count(), db.mortalityEvent.count(), db.eggCollection.count(), db.sale.count(), db.expense.count()]);
console.log("rows: checks, feed, deaths, eggs, sales, expenses =", counts.join(", "));
await db.$disconnect();
