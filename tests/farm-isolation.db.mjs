// Many farms on one Flockence (2026-11-02): one farm must never see, change or point at another farm's records.
// Needs a disposable database (its name must contain "test"):
//   DATABASE_URL=postgresql://.../flockence_isolation_test npx prisma db push
//   DATABASE_URL=... node --experimental-strip-types --import ./tests/support/register-alias.mjs --test tests/farm-isolation.db.mjs
import test from "node:test";
import assert from "node:assert/strict";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost");
if (!/^\/[A-Za-z0-9_]+_test$/.test(databaseUrl.pathname)) {
  console.error("Refusing: DATABASE_URL must name a disposable database ending in _test.");
  process.exit(2);
}
process.env.AUTH_SECRET ??= "t".repeat(40);

const { prisma } = await import("../lib/prisma.ts");
const { lockFlockOperations } = await import("../lib/poultry-lock.ts");
const { runAsFarm, runUnscoped, FarmScopeError } = await import("../lib/farm-scope.ts");
const { saveFarmLink, farmLinkConfig } = await import("../lib/oriya-farm-link.ts");

const A = "iso-farm-a", B = "iso-farm-b";

async function reset() {
  await runUnscoped(async () => {
    await prisma.farm.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.farm.create({ data: { id: A, name: "Farm A" } });
    await prisma.farm.create({ data: { id: B, name: "Farm B" } });
  });
}
const batchData = (name) => ({ name, startDate: new Date("2026-10-01"), initialChicks: 100, chickCostMinor: 290, status: "ACTIVE" });

test.before(reset);
test.after(async () => { await runUnscoped(() => prisma.farm.deleteMany({ where: { id: { in: [A, B] } } })); await prisma.$disconnect(); });

test("a query with no farm is refused", async () => {
  await assert.rejects(() => prisma.batch.findMany(), (e) => e instanceof FarmScopeError);
});

test("reads, updates and deletes stay inside the farm", async () => {
  const a = await runAsFarm(A, () => prisma.batch.create({ data: batchData("A flock") }));
  assert.equal(a.farmId, A);
  assert.equal((await runAsFarm(B, () => prisma.batch.findMany())).length, 0);
  assert.equal(await runAsFarm(B, () => prisma.batch.findUnique({ where: { id: a.id } })), null);
  assert.equal(await runAsFarm(B, () => prisma.batch.count()), 0);
  await assert.rejects(() => runAsFarm(B, () => prisma.batch.update({ where: { id: a.id }, data: { name: "stolen" } })));
  assert.equal((await runAsFarm(B, () => prisma.batch.updateMany({ where: { id: a.id }, data: { name: "stolen" } }))).count, 0);
  assert.equal((await runAsFarm(B, () => prisma.batch.deleteMany({}))).count, 0);
  assert.equal((await runAsFarm(A, () => prisma.batch.findUnique({ where: { id: a.id } })))?.name, "A flock");
});

test("a row cannot be written into, or moved to, another farm", async () => {
  await assert.rejects(() => runAsFarm(B, () => prisma.batch.create({ data: { ...batchData("x"), farmId: A } })), (e) => e instanceof FarmScopeError);
  const b = await runAsFarm(B, () => prisma.batch.create({ data: batchData("B flock") }));
  await assert.rejects(() => runAsFarm(B, () => prisma.batch.update({ where: { id: b.id }, data: { farmId: A } })), (e) => e instanceof FarmScopeError);
});

test("records under a flock follow the flock's farm, and cannot point at another farm's flock", async () => {
  const a = await runAsFarm(A, () => prisma.batch.findFirst());
  const death = await runAsFarm(A, () => prisma.mortalityEvent.create({ data: { batchId: a.id, date: new Date(), quantity: 2 } }));
  assert.equal((await runAsFarm(B, () => prisma.mortalityEvent.findMany())).length, 0);
  assert.equal(await runAsFarm(B, () => prisma.mortalityEvent.findUnique({ where: { id: death.id } })), null);
  await assert.rejects(() => runAsFarm(B, () => prisma.mortalityEvent.create({ data: { batchId: a.id, date: new Date(), quantity: 1 } })), (e) => e instanceof FarmScopeError);
  await assert.rejects(() => runAsFarm(B, () => prisma.mortalityEvent.create({ data: { date: new Date(), quantity: 1, batch: { connect: { id: a.id } } } })), (e) => e instanceof FarmScopeError);
  assert.equal((await runAsFarm(A, () => prisma.mortalityEvent.findMany())).length, 1);
});

test("a sale cannot use another farm's customer", async () => {
  const customer = await runAsFarm(A, () => prisma.customer.create({ data: { name: "A buyer" } }));
  await assert.rejects(() => runAsFarm(B, () => prisma.sale.create({ data: { date: new Date(), totalMinor: 100, customerId: customer.id } })), (e) => e instanceof FarmScopeError);
  const ok = await runAsFarm(A, () => prisma.sale.create({ data: { date: new Date(), totalMinor: 100, customerId: customer.id } }));
  assert.equal(ok.farmId, A);
});

test("transactions are kept to the farm too", async () => {
  const count = await runAsFarm(B, () => prisma.$transaction(async (tx) => tx.batch.count()));
  assert.equal(count, 1);
});

test("flock transaction locks work through Prisma and release at commit", async () => {
  const batch = await runAsFarm(A, () => prisma.batch.findFirstOrThrow());
  await runAsFarm(A, () => prisma.$transaction((tx) => lockFlockOperations(tx, [batch.id, batch.id])));
  await runAsFarm(A, () => prisma.$transaction((tx) => lockFlockOperations(tx, [batch.id])));
});

test("each farm's Oriya link is its own, encrypted", async () => {
  process.env.ORIYA_URL = "https://oriya.si";
  await runAsFarm(A, () => saveFarmLink({ keyId: "cop_" + "a".repeat(24), secret: "x".repeat(43) }));
  const stored = await runAsFarm(A, () => prisma.setting.findUnique({ where: { farmId_key: { farmId: A, key: "ORIYA_LINK" } } }));
  assert.ok(stored && !stored.value.includes("x".repeat(43)));
  assert.equal((await runAsFarm(A, () => farmLinkConfig()))?.keyId, "cop_" + "a".repeat(24));
  assert.equal(await runAsFarm(B, () => farmLinkConfig()), null);
  // Copying A's sealed link into B's settings does not work: the farm is bound into the encryption.
  await runAsFarm(B, () => prisma.setting.create({ data: { key: "ORIYA_LINK", value: stored.value } }));
  assert.equal(await runAsFarm(B, () => farmLinkConfig()), null);
});

test("requests running at the same time each keep their own farm", async () => {
  const results = await Promise.all([A, B, A, B].map((farm) => runAsFarm(farm, async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 20));
    return (await prisma.batch.findMany()).map((b) => b.farmId);
  })));
  assert.deepEqual(results.map((ids) => [...new Set(ids)]), [[A], [B], [A], [B]]);
});

test("public farm preferences exclude server-owned settings and unknown keys", async () => {
  const { farmPreferenceKeys, isFarmPreferenceKey } = await import("../lib/farm-preferences.ts");
  assert.equal(farmPreferenceKeys.length, 6);
  for (const key of farmPreferenceKeys) assert.equal(isFarmPreferenceKey(key), true);
  for (const key of ["ORIYA_LINK", "ORIYA_SEEN::event", "AUTH_SESSION::session", "FARM_INVITE::code", "membership", null, {}]) {
    assert.equal(isFarmPreferenceKey(key), false);
  }
});

test("verified Free signup provisions independent farms and rolls back duplicate email", async () => {
  const { provisionFreeFarm } = await import("../lib/free-registration.ts");
  const { sessionFromToken, getPasswordHash, verifyPassword } = await import("../lib/auth.ts");
  const { randomUUID } = await import("node:crypto");
  const name = "Registration test " + randomUUID();
  const registration = { farmName: name, ownerName: "Farm owner", password: "Registration-test!23" };
  const email = randomUUID() + "@example.test";
  try {
    const first = await provisionFreeFarm({ ...registration, verifiedEmail: email });
    const second = await provisionFreeFarm({ ...registration, verifiedEmail: randomUUID() + "@example.test" });
    assert.notEqual(first.owner.farmId, second.owner.farmId);
    assert.equal(first.owner.role, "OWNER");
    assert.deepEqual(await sessionFromToken(first.session.token), { userId: first.owner.id, farmId: first.owner.farmId });
    assert.equal(await runAsFarm(second.owner.farmId, () => prisma.user.findUnique({ where: { id: first.owner.id } })), null);
    const hash = await runAsFarm(first.owner.farmId, () => getPasswordHash(first.owner.id));
    assert.ok(hash && await verifyPassword(registration.password, hash));
    const membership = await runAsFarm(first.owner.farmId, () => prisma.setting.findFirst({ where: { key: "MEMBERSHIP_V1" } }));
    assert.equal(membership?.value, "FREE");
    await assert.rejects(() => provisionFreeFarm({ ...registration, verifiedEmail: email.toUpperCase() }), { code: "P2002" });
    assert.equal(await runUnscoped(() => prisma.farm.count({ where: { name } })), 2);
  } finally {
    await runUnscoped(() => prisma.farm.deleteMany({ where: { name } }));
  }
});
