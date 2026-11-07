// Feed catalogue, suppliers and feed measures: farm-owned, never shared, and safe to start twice at once.
// Needs a disposable database (its name must contain "test"):
//   DATABASE_URL=postgresql://.../flockence_isolation_test npx prisma db push
//   DATABASE_URL=... node --experimental-strip-types --import ./tests/support/register-alias.mjs --test tests/feed-catalogue.db.mjs
import test from "node:test";
import assert from "node:assert/strict";

if (!/test/.test(process.env.DATABASE_URL ?? "")) { console.error("Refusing: DATABASE_URL must name a test database."); process.exit(2); }
process.env.AUTH_SECRET ??= "t".repeat(40);

const { prisma } = await import("../lib/prisma.ts");
const { runAsFarm, runUnscoped, FarmScopeError } = await import("../lib/farm-scope.ts");
const { ensureFeedCatalogue, STARTER_FEEDS } = await import("../lib/feed-catalogue.ts");
const { convertFeed } = await import("../lib/feed-entry.ts");

const A = "feed-farm-a", B = "feed-farm-b";
const starter = Object.values(STARTER_FEEDS).flat().length;

test.before(async () => runUnscoped(async () => {
  await prisma.farm.deleteMany({ where: { id: { in: [A, B] } } });
  await prisma.farm.create({ data: { id: A, name: "Feed A" } });
  await prisma.farm.create({ data: { id: B, name: "Feed B" } });
}));
test.after(async () => { await runUnscoped(() => prisma.farm.deleteMany({ where: { id: { in: [A, B] } } })); await prisma.$disconnect(); });

test("two first-time openings at once give one catalogue, no duplicates, no error", async () => {
  await runAsFarm(A, async () => {
    await prisma.feedPurchase.create({ data: { farmId: A, date: new Date("2026-10-01"), feedType: "Super Feeds · Broiler Grower", bagSizeKg: 30, quantityBags: 2, unitCostMinor: 6000 } });
    await prisma.feedPurchase.create({ data: { farmId: A, date: new Date("2026-10-02"), feedType: "Home mix", bagSizeKg: 25, quantityBags: 1, unitCostMinor: 3000 } });
    await Promise.all([prisma.$transaction(tx => ensureFeedCatalogue(tx, A)), prisma.$transaction(tx => ensureFeedCatalogue(tx, A))]);
    const rows = await prisma.feedProduct.findMany({ where: { farmId: A } });
    assert.equal(rows.length, starter + 1);                       // the starter list + "Home mix" from an old purchase
    assert.equal(new Set(rows.map(r => r.brand + "::" + r.name)).size, rows.length);
    const linked = await prisma.feedPurchase.findMany({ where: { farmId: A }, select: { feedProductId: true } });
    assert.ok(linked.every(p => p.feedProductId), "old purchases are linked to their product");
  });
});

test("one farm never sees or points at another farm's feeds, measures or suppliers", async () => {
  const [feedA, measureA, supplierA] = await runAsFarm(A, async () => [
    await prisma.feedProduct.findFirstOrThrow({ where: { farmId: A } }),
    await prisma.feedMeasure.create({ data: { farmId: A, name: "Scoop", kgPerUnit: 1.2 } }),
    await prisma.supplier.create({ data: { farmId: A, name: "Dealer A", category: "FEED" } }),
  ]);
  await runAsFarm(B, async () => {
    assert.equal(await prisma.feedProduct.count(), 0);
    assert.equal(await prisma.feedMeasure.count(), 0);
    assert.equal(await prisma.supplier.count(), 0);
    await assert.rejects(() => prisma.feedProductSupplier.create({ data: { farmId: B, feedProductId: feedA.id, supplierId: supplierA.id } }), (e) => e instanceof FarmScopeError);
    await assert.rejects(() => prisma.feedPurchase.create({ data: { farmId: B, date: new Date(), feedType: "x", feedProductId: feedA.id, bagSizeKg: 30, quantityBags: 1, unitCostMinor: 1 } }), (e) => e instanceof FarmScopeError);
    const r = await prisma.$transaction(tx => convertFeed(tx, B, { amount: 2, unit: "MEASURE", measureId: measureA.id }));
    assert.equal(r.ok, false, "another farm's scoop cannot be used");
  });
});

test("bags use the feed's own size, then the farm's usual size; a scoop needs its weight", async () => {
  await runAsFarm(A, async () => {
    await prisma.setting.upsert({ where: { farmId_key: { farmId: A, key: "default_bag_kg" } }, create: { farmId: A, key: "default_bag_kg", value: "30" }, update: { value: "30" } });
    const mash = await prisma.feedProduct.create({ data: { farmId: A, brand: "Mill", name: "Mash", defaultBagKg: 25 } });
    const plain = await prisma.feedProduct.create({ data: { farmId: A, brand: "Mill", name: "Plain" } });
    const conv = (args) => prisma.$transaction(tx => convertFeed(tx, A, args));
    assert.equal((await conv({ amount: 1, unit: "BAG", feedProductId: mash.id })).kg, 25);
    assert.equal((await conv({ amount: 1.5, unit: "BAG", feedProductId: plain.id })).kg, 45);
    const bare = await prisma.feedMeasure.create({ data: { farmId: A, name: "Pan" } });
    assert.equal((await conv({ amount: 2, unit: "MEASURE", measureId: bare.id })).ok, false);
  });
});
