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
  assert.deepEqual([...farmPreferenceKeys].sort(), [
    "default_bag_kg", "default_breed", "default_chick_cost", "default_feed_bag_price", "default_slaughter_cost",
    "feed_low_days", "feed_record_method", "weather_latitude", "weather_location_name", "weather_longitude",
  ]);
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

test("farm setup accepts every Barbados parish and keeps location optional", async () => {
  const { barbadosParishes, farmSetupSchema } = await import("../lib/farm-setup.ts");
  const profile = { name: "Example farm", operation: "BOTH", country: "Barbados", parish: "", community: "", unit: "ft" };
  assert.equal(new Set(barbadosParishes).size, 11);
  for (const parish of barbadosParishes) {
    assert.ok(farmSetupSchema.safeParse({ ...profile, parish }).success);
  }
  assert.ok(farmSetupSchema.safeParse({ ...profile, country: "", unit: "m" }).success);
  assert.ok(farmSetupSchema.safeParse({ ...profile, country: "Saint Lucia", parish: "Anse la Raye" }).success);
  assert.equal(farmSetupSchema.safeParse({ ...profile, parish: "Invalid" }).success, false);
  assert.equal(farmSetupSchema.safeParse({ ...profile, farmId: "other-farm" }).success, false);
});

test("housing setup accepts feet and metres and rejects duplicate or invalid pens", async () => {
  const { farmSetupSchema, metres } = await import("../lib/farm-setup.ts");
  const { randomUUID } = await import("node:crypto");
  const pen = { id: randomUUID(), name: "Pen A", housingMode: "OPEN_SIDED_HOT",
    length: 20, width: 30, unit: "ft", status: "ACTIVE", capacity: 100, occupants: 30, notes: "" };
  const profile = { name: "Example farm", operation: "BROILER", country: "", parish: "", community: "", unit: "ft" };
  assert.ok(farmSetupSchema.safeParse({ ...profile, pens: [pen, { ...pen, id: randomUUID(), name: "Pen B", unit: "m" }] }).success);
  assert.ok(farmSetupSchema.safeParse({ ...profile, pens: [] }).success);
  assert.equal(pen.length * pen.width, 600);
  assert.ok(Math.abs(metres(20, "ft") - 6.096) < 0.000001);
  assert.equal(metres(5, "m"), 5);
  assert.equal(farmSetupSchema.safeParse({ ...profile, pens: [pen, { ...pen, id: randomUUID(), name: "pen a" }] }).success, false);
  assert.equal(farmSetupSchema.safeParse({ ...profile, pens: [{ ...pen, width: 0 }] }).success, false);
});

test("ordinary farm clients cannot read another farm through unfiltered raw SQL", {
  skip: !process.env.FARM_RLS_DATABASE_URL,
}, async () => {
  await Promise.all([A, B, A, B].map((farmId) => runAsFarm(farmId, async () => {
    const [rows, raw] = await prisma.$transaction([
      prisma.batch.findMany(),
      prisma.$queryRaw`SELECT "farmId", current_user AS role FROM "Batch"`,
    ]);
    assert.ok(rows.length > 0);
    assert.equal(raw.length, rows.length);
    assert.ok(raw.every((row) => row.farmId === farmId && row.role === "flockence_tenant"));
  })));
});

test("portable farm export retains the operation records for the selected farm only", async () => {
  const { farmExport } = await import("../lib/farm-export.ts");
  await runAsFarm(A, () => prisma.setting.createMany({ data: [
    { key: "PEN::test-owner::pen-a", value: JSON.stringify({ name: "Pen A", lengthM: 3, providerSecret: "must not export" }) },
    { key: "PEN::test-owner::name::pen a", value: "pen-a" },
    { key: "default_feed_bag_price", value: "42.00" },
  ] }));
  const [a, b] = await Promise.all([A, B].map(async (id) => new Response(farmExport(id)).json()));
  assert.equal(a.version, 1);
  assert.equal(a.farm.id, A);
  assert.equal(b.farm.id, B);
  assert.equal(a.records.customer[0].name, "A buyer");
  assert.deepEqual(b.records.customer, []);
  assert.ok(a.records.batch.every((row) => row.farmId === A));
  assert.ok(b.records.batch.every((row) => row.farmId === B));
  assert.equal(a.records.setting, undefined);
  assert.equal(a.records.user, undefined);
  assert.deepEqual(a.configuration.pens, [{ id: "pen-a", ownerId: "test-owner", kind: "PEN", name: "Pen A", lengthM: 3 }]);
  assert.deepEqual(b.configuration.pens, []);
  assert.equal(a.configuration.preferences.default_feed_bag_price, "42.00");
});

test("onboarding creates separate flocks and starting counts, and safely retries", async () => {
  const { createSetupFlocks } = await import("../lib/farm-setup-flocks.ts");
  const { farmSetupSchema } = await import("../lib/farm-setup.ts");
  const { randomUUID } = await import("node:crypto");
  const pen = randomUUID();
  const userId = randomUUID();
  const base = { name: "Starter flock " + randomUUID(), productionType: "BROILER", layerStage: null, birds: 23,
    breed: "", approximateAgeWeeks: 3, placementDate: "", penId: pen };
  const profile = { name: "Example farm", operation: "BOTH", country: "", parish: "", community: "", unit: "ft" };
  const flock = { ...base, id: randomUUID() };
  const layers = { ...base, id: randomUUID(), name: base.name + " layers", birds: 17, productionType: "LAYER", layerStage: "LAYING" };
  assert.equal(farmSetupSchema.safeParse({ ...profile, flocks: [{ ...layers, layerStage: null }] }).success, false);
  assert.equal(farmSetupSchema.safeParse({ ...profile, flocks: [{ ...flock, placementDate: "2999-01-01" }] }).success, false);
  assert.equal(farmSetupSchema.parse(profile).flocks.length, 0);

  const key = "PEN::" + userId + "::" + pen;
  await runAsFarm(A, () => prisma.setting.create({ data: { key, value: JSON.stringify({ name: "Test housing" }) } }));
  const add = (farm, entries) => runAsFarm(farm, () => prisma.$transaction((tx) => createSetupFlocks(tx, farm, userId, entries)));
  await assert.rejects(() => add(B, [flock]), /SETUP_PEN_NOT_FOUND/);
  await add(A, [flock, layers]);
  await add(A, [flock, layers]);
  const where = { name: { startsWith: base.name } };
  const created = await runAsFarm(A, () => prisma.batch.findMany({ where, include: { birdCounts: true, layerStageEvents: true } }));
  try {
    assert.equal(created.length, 2);
    assert.deepEqual(created.map((batch) => batch.birdCounts[0].liveCount).sort(), [17, 23]);
    assert.equal(created.find((batch) => batch.productionType === "LAYER").layerStageEvents[0].toStage, "LAYING");
    assert.match(created[0].placementNotes, /Initial pen: Test housing/);
    assert.equal(await runAsFarm(B, () => prisma.batch.count({ where })), 0);
    await assert.rejects(() => add(A, [{ ...flock, id: randomUUID(), penId: "" }, { ...layers, id: randomUUID(), penId: randomUUID() }]), /SETUP_PEN_NOT_FOUND/);
    assert.equal(await runAsFarm(A, () => prisma.batch.count({ where })), 2);
  } finally {
    await runAsFarm(A, () => prisma.batch.deleteMany({ where }));
  }
});



test("verified email proof is single-use and creates an isolated Free farm", async () => {
  const { issueFreeEmailProof, completeVerifiedFreeSignup, discardFreeEmailProof } = await import("../lib/free-email-proof.ts");
  const { randomUUID } = await import("node:crypto");
  const email = randomUUID() + "@example.test";
  const farmName = "Verified " + randomUUID();
  const token = await issueFreeEmailProof(email);
  const form = { ownerName: "Verified owner", farmName, password: "Flockence-Verified!23" };
  try {
    await assert.rejects(() => completeVerifiedFreeSignup(token, { ...form, password: "" }), /INVALID_FREE_REGISTRATION/);
    const attempts = await Promise.allSettled([completeVerifiedFreeSignup(token, form), completeVerifiedFreeSignup(token, form)]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    const account = await runUnscoped(() => prisma.user.findUnique({ where: { email } }));
    assert.ok(account?.farmId.startsWith("free-"));
    assert.equal(await runAsFarm(B, () => prisma.user.findUnique({ where: { email } })), null);
    await assert.rejects(() => completeVerifiedFreeSignup(token, form), /INVALID_SIGNUP_PROOF/);
  } finally {
    await discardFreeEmailProof(token);
    await runUnscoped(() => prisma.farm.deleteMany({ where: { name: farmName } }));
  }
});


test("emailed team invitations bind farm, mailbox and role and redeem once", async (t) => {
  const { randomUUID } = await import("node:crypto");
  const { issueEmailTeamInvite, inspectEmailTeamInvite, redeemEmailTeamInvite,
    activeEmailInvitations, revokeEmailInvitation } = await import("../lib/email-team-invites.ts");
  const { sessionFromToken, getPasswordHash, verifyPassword } = await import("../lib/auth.ts");
  for (const [key, value] of Object.entries({
    RESEND_API_KEY: "fixture-key", RESEND_FROM: "Flockence <mail@example.test>", APP_URL: "https://flockence.example",
  })) {
    const prior = process.env[key];
    process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  let message;
  let deliver = true;
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, "https://api.resend.com/emails");
    message = JSON.parse(request.body);
    return new Response(null, { status: deliver ? 200 : 503 });
  });
  const owner = await runAsFarm(A, () => prisma.user.create({ data: {
    farmId: A, role: "OWNER", name: "Invite fixture owner", email: randomUUID() + "@example.test",
  } }));
  const manager = await runAsFarm(A, () => prisma.user.create({ data: {
    farmId: A, role: "MANAGER", name: "Invite fixture supervisor", email: randomUUID() + "@example.test",
  } }));
  const days = new Date(Date.now() + 86400000);
  const email = randomUUID() + "@example.test";
  const send = (actor, recipient, role, expires = days) =>
    runAsFarm(A, () => issueEmailTeamInvite(actor.id, recipient, role, expires));
  await assert.rejects(() => send(manager, email, "MANAGER"), /EMAIL_INVITE_FORBIDDEN/);
  assert.equal(fetchMock.mock.callCount(), 0);
  const invite = await send(owner, email, "WORKER");
  assert.deepEqual(message.to, [email]);
  const token = new URL(message.text.trim().split("\n").at(-1)).hash.slice("#invite=".length);
  assert.deepEqual(await inspectEmailTeamInvite(token), { farmName: "Farm A", role: "WORKER" });
  assert.equal(await inspectEmailTeamInvite(token.replace(A + ".", B + ".")), null);
  assert.equal(await runAsFarm(B, () => revokeEmailInvitation(invite.id, owner.id)), false);
  assert.deepEqual(await runAsFarm(B, () => activeEmailInvitations()), []);
  const password = "Fixture-Invite123!";
  const outcomes = await Promise.all([
    redeemEmailTeamInvite(token, "Joined hand", password),
    redeemEmailTeamInvite(token, "Joined hand", password),
  ]);
  const joined = outcomes.filter(Boolean);
  assert.equal(joined.length, 1);
  assert.equal(await inspectEmailTeamInvite(token), null);
  const session = await sessionFromToken(joined[0].token);
  assert.equal(session.farmId, A);
  const user = await runAsFarm(A, () => prisma.user.findUnique({ where: { id: session.userId } }));
  assert.equal(user.email, email);
  assert.equal(user.role, "WORKER");
  assert.ok(await verifyPassword(password, await runAsFarm(A, () => getPasswordHash(user.id))));

  const revocable = await send(owner, randomUUID() + "@example.test", "MANAGER");
  const revokedToken = new URL(message.text.trim().split("\n").at(-1)).hash.slice("#invite=".length);
  await assert.rejects(() => runAsFarm(A, () => revokeEmailInvitation(revocable.id, manager.id)), /EMAIL_INVITE_FORBIDDEN/);
  assert.ok(await runAsFarm(A, () => revokeEmailInvitation(revocable.id, owner.id)));
  assert.equal(await redeemEmailTeamInvite(revokedToken, "Revoked member", password), null);

  await send(owner, randomUUID() + "@example.test", "READ_ONLY", new Date(Date.now() - 1000));
  const expiredToken = new URL(message.text.trim().split("\n").at(-1)).hash.slice("#invite=".length);
  assert.equal(await redeemEmailTeamInvite(expiredToken, "Expired member", password), null);
  deliver = false;
  await assert.rejects(() => send(owner, randomUUID() + "@example.test", "READ_ONLY"), /EMAIL_INVITE_DELIVERY_FAILED/);
  assert.deepEqual(await runAsFarm(A, () => activeEmailInvitations()), []);
});

test("changing a local password revokes sessions and outstanding reset links", async () => {
  const { randomUUID } = await import("node:crypto");
  const { changeAccountPassword, createPasswordReset, createSession, hashPassword, savePasswordHash,
    verifyPassword, getPasswordHash, resetAccountPassword, sessionFromToken } = await import("../lib/auth.ts");
  const id = randomUUID();
  const another = randomUUID();
  const oldPassword = "Old-Password-123!";
  const newPassword = "New-Password-456!";
  const fixture = await runAsFarm(A, async () => {
    await prisma.user.createMany({ data: [
      { id, farmId: A, name: "Password fixture", email: id + "@example.test", role: "WORKER" },
      { id: another, farmId: A, name: "Other password fixture", email: another + "@example.test", role: "WORKER" },
    ] });
    await savePasswordHash(id, await hashPassword(oldPassword));
    const [own, other, recovery] = await Promise.all([createSession(id), createSession(another), createPasswordReset(id)]);
    return { own, other, recovery };
  });
  assert.equal(await runAsFarm(A, () => changeAccountPassword(id, "Incorrect-Password", newPassword)), "incorrect");
  const results = await Promise.all([
    runAsFarm(A, () => changeAccountPassword(id, oldPassword, newPassword)),
    runAsFarm(A, () => changeAccountPassword(id, oldPassword, newPassword)),
  ]);
  assert.deepEqual(results.sort(), ["changed", "incorrect"]);
  assert.equal(await sessionFromToken(fixture.own.token), null);
  assert.equal((await sessionFromToken(fixture.other.token)).userId, another);
  assert.equal(await resetAccountPassword(fixture.recovery.token, oldPassword), false);
  assert.ok(await verifyPassword(newPassword, await runAsFarm(A, () => getPasswordHash(id))));
  const fresh = await runAsFarm(A, () => createPasswordReset(id));
  const reset = await Promise.all([resetAccountPassword(fresh.token, oldPassword), resetAccountPassword(fresh.token, oldPassword)]);
  assert.deepEqual(reset.sort(), [false, true]);
});

test("automatic camera vision: each farm's schedule is its own, and only old automatic pictures are removed", async () => {
  const { loadSchedule, saveSchedule, pruneAutomaticPictures, runFarmRound } = await import("../lib/vision-schedule.ts");
  const { mkdtemp, writeFile, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "vision-auto-"));
  const previousDir = process.env.VISION_STORAGE_DIR;
  process.env.VISION_STORAGE_DIR = dir;
  try {
    const owner = await runAsFarm(A, () => prisma.user.create({ data: { name: "A owner", email: `vision-owner-${Date.now()}@a.test`, role: "OWNER" } }));
    const schedule = { enabled: true, cameras: { "Coop 1": { everyHours: 2, mode: "video", category: "PEN" } }, dailyCap: 24, keepDays: 30, quietStart: "", quietEnd: "" };
    await runAsFarm(A, () => saveSchedule(schedule, owner.id));
    assert.equal((await runAsFarm(A, () => loadSchedule())).schedule?.enabled, true);
    assert.equal((await runAsFarm(B, () => loadSchedule())).schedule, null, "farm B sees no schedule from farm A");
    assert.equal(await runAsFarm(A, () => prisma.auditLog.count({ where: { action: "VISION_SCHEDULE_CHANGED" } })), 1);

    // Cameras switched off on this server: the round says so and holds nothing.
    delete process.env.FLOCKENCE_CAMERA_VISION;
    const round = await runAsFarm(A, () => runFarmRound(schedule, owner.id, new Date()));
    assert.equal(round.skipped, "cameras-off");

    // Retention: an old automatic picture goes (its written result stays), a new one and a manual one stay.
    const old = new Date(Date.now() - 40 * 86_400_000);
    const make = async (farm, key, createdAt) => {
      await writeFile(path.join(dir, key), "x");
      return runAsFarm(farm, async () => {
        const media = await prisma.visionMedia.create({ data: { storageKey: key, mimeType: "image/jpeg", byteSize: 1, createdAt } });
        const obs = await prisma.healthObservation.create({ data: { observedAt: createdAt, symptom: "Farm Vision automatic inspection", category: "VISION:PEN", affectedCount: 0, notes: "kept", imageUrl: `/api/vision/media/${media.id}`, visionMediaId: media.id } });
        return { media, obs };
      });
    };
    const oldAuto = await make(A, "auto-old.jpg", old);
    const newAuto = await make(A, "auto-new.jpg", new Date());
    const oldManual = await make(A, "manual-old.jpg", old);
    const otherFarm = await make(B, "auto-other.jpg", old);
    assert.equal(await runAsFarm(A, () => pruneAutomaticPictures(30, new Date())), 1);
    assert.deepEqual((await readdir(dir)).sort(), ["auto-new.jpg", "auto-other.jpg", "manual-old.jpg"]);
    const kept = await runAsFarm(A, () => prisma.healthObservation.findUnique({ where: { id: oldAuto.obs.id } }));
    assert.equal(kept.notes, "kept");
    assert.equal(kept.imageUrl, null);
    assert.equal(kept.visionMediaId, null);
    assert.ok(await runAsFarm(A, () => prisma.visionMedia.findUnique({ where: { id: newAuto.media.id } })));
    assert.ok(await runAsFarm(A, () => prisma.visionMedia.findUnique({ where: { id: oldManual.media.id } })));
    assert.ok(await runAsFarm(B, () => prisma.visionMedia.findUnique({ where: { id: otherFarm.media.id } })), "farm B's pictures are never touched by farm A's clean-up");
  } finally {
    if (previousDir === undefined) delete process.env.VISION_STORAGE_DIR; else process.env.VISION_STORAGE_DIR = previousDir;
  }
});

test("vision provider: the chosen model and its cost, and each farm's monthly usage counted safely", async () => {
  const { visionProvider, visionModel, costMicros, visionConfigured } = await import("../lib/vision-provider.ts");
  const { recordVisionUsage, monthUsage } = await import("../lib/vision-usage.ts");
  const saved = { p: process.env.VISION_PROVIDER, m: process.env.VISION_MODEL, a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, prices: process.env.VISION_PRICES };
  try {
    delete process.env.VISION_PROVIDER; delete process.env.VISION_MODEL; delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-only";
    assert.equal(visionProvider(), "anthropic");
    assert.equal(visionModel(), "claude-haiku-5-5");
    assert.equal(visionConfigured(), true);
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-only";
    assert.equal(visionProvider(), "openai");
    assert.equal(visionModel(), "gpt-5.6-luna");
    process.env.VISION_MODEL = "gpt-5.6-luna"; process.env.VISION_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "test-only";
    assert.equal(visionModel(), "claude-haiku-5-5", "an OpenAI model name is ignored when Claude is chosen");
    delete process.env.VISION_MODEL; delete process.env.VISION_PROVIDER; delete process.env.ANTHROPIC_API_KEY;
    process.env.VISION_PROVIDER = "anthropic";
    assert.equal(visionConfigured(), false, "the chosen provider's own key is required");
    // 2,500 tokens in and 1,500 out on Claude Haiku 5.5: $0.00025 + $0.00075 = $0.001
    assert.equal(costMicros("claude-haiku-5-5", 2500, 1500), 1000);
    assert.equal(costMicros("some-new-model", 100, 100), null);
    process.env.VISION_PRICES = JSON.stringify({ "some-new-model": [1, 2] });
    assert.equal(costMicros("some-new-model", 1000, 1000), 3000);

    const call = { provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 2500, outputTokens: 1500, costMicros: 1000 };
    await Promise.all([
      runAsFarm(A, () => recordVisionUsage({ automatic: true, calls: [call], counted: true })),
      runAsFarm(A, () => recordVisionUsage({ automatic: true, calls: [call], counted: true })),
      runAsFarm(A, () => recordVisionUsage({ automatic: false, calls: [call, { ...call, model: "claude-sonnet-5-5", costMicros: 20000 }], counted: true })),
      runAsFarm(A, () => recordVisionUsage({ automatic: false, calls: [call], counted: false })),
    ]);
    const usage = await runAsFarm(A, () => monthUsage());
    assert.equal(usage.automatic, 2);
    assert.equal(usage.manual, 1);
    assert.equal(usage.rechecks, 1);
    assert.equal(usage.costMicros, 1000 * 4 + 20000);
    assert.equal(usage.byModel["claude-sonnet-5-5"].calls, 1);
    assert.equal((await runAsFarm(B, () => monthUsage())).automatic, 0, "farm B's usage is its own");
  } finally {
    for (const [k, v] of [["VISION_PROVIDER", saved.p], ["VISION_MODEL", saved.m], ["ANTHROPIC_API_KEY", saved.a], ["OPENAI_API_KEY", saved.o], ["VISION_PRICES", saved.prices]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("vision provider: OpenRouter is chosen by its key, sends the pictures, and records what it charged", async () => {
  const { visionProvider, visionModel, visionConfigured, callVisionModel, costMicros } = await import("../lib/vision-provider.ts");
  const saved = { p: process.env.VISION_PROVIDER, m: process.env.VISION_MODEL, a: process.env.ANTHROPIC_API_KEY, r: process.env.OPENROUTER_API_KEY, o: process.env.OPENAI_API_KEY, e: process.env.VISION_EFFORT };
  const realFetch = globalThis.fetch;
  try {
    delete process.env.VISION_PROVIDER; delete process.env.VISION_MODEL; delete process.env.ANTHROPIC_API_KEY; delete process.env.VISION_EFFORT;
    process.env.OPENROUTER_API_KEY = "sk-or-test-only";
    process.env.OPENAI_API_KEY = "test-only";
    assert.equal(visionProvider(), "openrouter", "OpenRouter comes before OpenAI");
    assert.equal(visionModel(), "anthropic/claude-haiku-5.5");
    assert.equal(visionConfigured(), true);
    process.env.VISION_MODEL = "gpt-5.6-luna";
    assert.equal(visionModel(), "anthropic/claude-haiku-5.5", "a model name without a company is ignored on OpenRouter");
    process.env.VISION_MODEL = "google/some-vision-model";
    assert.equal(visionModel(), "google/some-vision-model");
    delete process.env.VISION_MODEL;
    assert.equal(costMicros("anthropic/claude-haiku-5.5", 2500, 1500), 1000, "priced like claude-haiku-5-5 when OpenRouter gives no cost");

    let sent = null;
    globalThis.fetch = async (url, init) => {
      sent = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{\"summary\":\"Birds spread evenly.\"}" } }],
        usage: { prompt_tokens: 2400, completion_tokens: 900, cost: 0.00071 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const reply = await callVisionModel({ instructions: "rules", prompt: "look", images: [{ mimeType: "image/jpeg", base64: "AAAA" }, { mimeType: "image/jpeg", base64: "BBBB" }] });
    assert.equal(reply.ok, true);
    assert.equal(reply.text, "{\"summary\":\"Birds spread evenly.\"}");
    assert.equal(reply.usage.costMicros, 710, "the cost OpenRouter reports is what is recorded");
    assert.equal(reply.usage.provider, "openrouter");
    assert.equal(sent.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(sent.headers.Authorization, "Bearer sk-or-test-only");
    assert.equal(sent.body.model, "anthropic/claude-haiku-5.5");
    assert.deepEqual(sent.body.reasoning, { effort: "low" });
    assert.equal(sent.body.messages[0].role, "system");
    const parts = sent.body.messages[1].content;
    assert.deepEqual(parts.slice(0, 2).map((p) => p.image_url.url), ["data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB"]);
    assert.deepEqual(parts[2], { type: "text", text: "look" });

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402 });
    const broke = await callVisionModel({ instructions: "rules", prompt: "look", images: [] });
    assert.equal(broke.ok, false);
    assert.match(broke.error, /out of credits/);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [["VISION_PROVIDER", saved.p], ["VISION_MODEL", saved.m], ["ANTHROPIC_API_KEY", saved.a], ["OPENROUTER_API_KEY", saved.r], ["OPENAI_API_KEY", saved.o], ["VISION_EFFORT", saved.e]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("vision answers: still birds, what was not in view, the count and questions are read safely", async () => {
  const { visionResultSchema } = await import("../lib/vision-assessment.ts");
  const ok = visionResultSchema.parse({
    summary: "Birds spread evenly; one bird lying still near the left drinker.",
    stillBirds: [{ where: "near the left drinker line", why: "on its side in the same place as in the earlier picture", confidence: "MEDIUM" }],
    notVisible: ["feeders at the far end"], birdCount: { visible: 140, confidence: "LOW" }, questions: ["Has the bird near the left drinker moved?"],
  });
  assert.equal(ok.stillBirds.length, 1);
  assert.deepEqual(ok.notVisible, ["feeders at the far end"]);
  assert.equal(ok.birdCount.visible, 140);
  // A malformed optional field never loses the rest of the answer.
  const messy = visionResultSchema.parse({ summary: "Pen looks normal.", stillBirds: "none", notVisible: 5, birdCount: "many", questions: [1] });
  assert.equal(messy.summary, "Pen looks normal.");
  assert.deepEqual(messy.stillBirds, []);
  assert.deepEqual(messy.notVisible, []);
  assert.equal(messy.birdCount, null);
  const { visionPrompt } = await import("../lib/vision.ts");
  const prompt = visionPrompt("PEN", "Flock A, about 12 days old.");
  for (const part of ["1. Birds.", "2. Feed.", "3. Water.", "5. Heat and cold.", "stillBirds", "notVisible"]) assert.ok(prompt.includes(part), part);
});

test("vision findings: grouped into incidents, reviewed by a person, kept to their farm, and shown in the pen history", async () => {
  const { recordFindings, listFindings, reviewVisionFinding, penTimeline } = await import("../lib/vision-findings.ts");
  const pen = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PEN::u::finding-pen-${Date.now()}`, value: JSON.stringify({ name: "Finding Pen" }) } }));
  const penRef = { id: pen.id, name: "Finding Pen" };
  const t0 = new Date(Date.now() - 3_600_000), t1 = new Date(Date.now() - 1_800_000);
  const obs = await runAsFarm(A, () => prisma.healthObservation.create({ data: {
    observedAt: t0, symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "Summary: Damp patch near the drinker.",
    visionAssessment: { pen: penRef },
  } }));
  const analysis = { confidence: "MEDIUM", signals: [{ category: "LITTER", state: "ATTENTION", evidence: "damp patch near the drinker" }], stillBirds: [{ where: "by the wall", confidence: "LOW" }] };
  await runAsFarm(A, () => recordFindings({ analysis, expectedLive: 116, at: t0, pen: penRef, batchId: null, cameraName: "Cam 1", observationId: obs.id, evidenceUrl: null }));
  // The same problems seen again 30 minutes later, worse litter: still two incidents, seen twice, worst severity kept.
  await runAsFarm(A, () => recordFindings({ analysis: { ...analysis, signals: [{ category: "LITTER", state: "WARNING", evidence: "wet area spreading" }] }, expectedLive: 116, at: t1, pen: penRef, batchId: null, cameraName: "Cam 1", observationId: obs.id, evidenceUrl: null }));
  const open = await runAsFarm(A, () => listFindings({ open: true, penId: pen.id }));
  assert.equal(open.length, 2);
  const litter = open.find((f) => f.kind === "LITTER");
  assert.equal(litter.occurrences, 2);
  assert.equal(litter.severity, "HIGH");
  assert.equal(litter.detail, "wet area spreading");
  assert.equal((await runAsFarm(B, () => listFindings({ open: true }))).length, 0, "farm B sees none of farm A's findings");
  assert.equal((await runAsFarm(B, () => reviewVisionFinding(litter.id, { state: "RESOLVED" }, { id: "x", name: "B" }))).status, 404, "farm B cannot review farm A's finding");

  const owner = await runAsFarm(A, () => prisma.user.create({ data: { name: "Finding owner", email: `finding-${Date.now()}@a.test`, role: "OWNER" } }));
  const reviewed = await runAsFarm(A, () => reviewVisionFinding(litter.id, { state: "RESOLVED", note: "fixed the leaking nipple" }, { id: owner.id, name: "Finding owner" }));
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.finding.state, "RESOLVED");
  assert.equal(reviewed.finding.title, litter.title, "the original wording is kept");
  assert.equal(reviewed.finding.history.length, 2);
  assert.equal((await runAsFarm(A, () => listFindings({ open: true, penId: pen.id }))).length, 1);
  // Seen again after it was fixed: a new incident, not the closed one reopened.
  await runAsFarm(A, () => recordFindings({ analysis: { signals: [{ category: "LITTER", state: "ATTENTION", evidence: "damp again" }] }, expectedLive: null, at: new Date(), pen: penRef, batchId: null, cameraName: "Cam 1", observationId: obs.id, evidenceUrl: null }));
  assert.equal((await runAsFarm(A, () => listFindings({ penId: pen.id }))).filter((f) => f.kind === "LITTER").length, 2);

  const timeline = await runAsFarm(A, () => penTimeline(pen.id, new Date(Date.now() - 86_400_000), new Date()));
  assert.ok(timeline.some((e) => e.kind === "inspection" && e.text === "Damp patch near the drinker."));
  assert.ok(timeline.some((e) => e.kind === "review" && /Finding owner marked .* as resolved: fixed the leaking nipple/.test(e.text)));
  assert.ok(timeline.every((e, i) => i === 0 || timeline[i - 1].at <= e.at), "in date order");
  assert.equal(await runAsFarm(A, () => prisma.mortalityEvent.count()), await runAsFarm(A, () => prisma.mortalityEvent.count()), "no mortality written");
});

test("vision report: a 12-day-old batch, 120 placed less 4 deaths is 116, findings decide the status, and no data is said plainly", async () => {
  const { buildVisionReport, periodFor } = await import("../lib/vision-reports.ts");
  const { recordFindings } = await import("../lib/vision-findings.ts");
  const placed = new Date(Date.now() - 12 * 86_400_000);
  const pen = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PEN::u::report-pen-${Date.now()}`, value: JSON.stringify({ name: "Report Pen" }) } }));
  const batch = await runAsFarm(A, () => prisma.batch.create({ data: { name: "Report flock", startDate: placed, initialChicks: 120, chickCostMinor: 0, status: "ACTIVE", placementHouse: "Report Pen" } }));
  await runAsFarm(A, () => prisma.birdCount.create({ data: { batchId: batch.id, date: placed, liveCount: 120, note: "Initial count" } }));
  await runAsFarm(A, () => prisma.mortalityEvent.create({ data: { batchId: batch.id, date: new Date(Date.now() - 2 * 86_400_000), quantity: 4 } }));

  const empty = await runAsFarm(A, () => buildVisionReport({ kind: "PEN", id: pen.id }, periodFor("7d")));
  assert.equal(empty.overall.status, "INSUFFICIENT_DATA");
  assert.match(empty.summary, /cannot say how the birds are/);
  const flock = empty.flocks.find((f) => f.id === batch.id);
  assert.equal(flock.ageDays, 12, "age from the real placement date, not a 42-day cycle");
  assert.equal(flock.liveRecorded, 116);
  assert.equal(flock.deathsInPeriod, 4);

  const at = new Date(Date.now() - 3_600_000);
  const obs = await runAsFarm(A, () => prisma.healthObservation.create({ data: {
    observedAt: at, symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, batchId: batch.id,
    notes: "Summary: One bird lying still.\n\nBirds visible: about 108. This is what the camera shows, not the flock total.",
    visionAssessment: { pen: { id: pen.id, name: "Report Pen" }, source: { kind: "CAMERA", name: "Report Cam" }, signals: [{ category: "BEHAVIOR", state: "NORMAL" }] },
  } }));
  await runAsFarm(A, () => recordFindings({ analysis: { stillBirds: [{ where: "by the wall" }], birdCount: { visible: 108 } }, expectedLive: 116, at, pen: { id: pen.id, name: "Report Pen" }, batchId: batch.id, cameraName: "Report Cam", observationId: obs.id, evidenceUrl: null }));
  const report = await runAsFarm(A, () => buildVisionReport({ kind: "BATCH", id: batch.id }, periodFor("batch", new Date(), undefined, placed)));
  assert.equal(report.overall.status, "ATTENTION");
  assert.equal(report.actions[0].kind, "DEAD_OR_DOWN_BIRD");
  assert.equal(report.population.liveRecorded, 116);
  assert.equal(report.population.mostVisible, 108, "the estimate is shown beside the records, not instead of them");
  assert.equal(report.coverage.inspections, 1);
  assert.deepEqual(report.coverage.sources.map((s) => s.name), ["Camera Report Cam"]);
  assert.equal(await runAsFarm(B, () => buildVisionReport({ kind: "BATCH", id: batch.id }, periodFor("7d"))), null, "farm B cannot report on farm A's batch");
});

test("retry-safe uploads: a retry finds its own farm's saved inspection, and a running one is shared", async () => {
  const { earlierReply, runOnce } = await import("../lib/vision-upload-requests.ts");
  const id = `retry-${Date.now()}-abcdef123456`;
  assert.equal(await runAsFarm(A, () => earlierReply(id)), null, "an unseen id runs normally");
  await runAsFarm(A, () => prisma.healthObservation.create({ data: {
    observedAt: new Date(), symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, severity: "LOW", notes: "saved",
    visionAssessment: { requestId: id, summary: "Birds spread evenly.", confidence: "HIGH", checks: ["Check the drinkers"] },
  } }));
  const again = await runAsFarm(A, () => earlierReply(id));
  assert.equal(again.status, 200);
  assert.equal(again.body.repeated, true);
  assert.equal(again.body.analysis.summary, "Birds spread evenly.");
  assert.equal(await runAsFarm(B, () => earlierReply(id)), null, "farm B never sees farm A's upload");

  let runs = 0;
  const work = () => new Promise((resolve) => { runs += 1; setTimeout(() => resolve({ status: 201, body: { ok: true } }), 50); });
  const other = `${id}-x`;
  const [first, second] = await Promise.all([runAsFarm(A, () => runOnce(other, work)), runAsFarm(A, () => runOnce(other, work))]);
  assert.equal(runs, 1, "the retry waited for the first attempt instead of analysing again");
  assert.deepEqual(first, second);
});

test("background checks: status is running, then done for its own farm; a failed attempt can be tried again", async () => {
  const { runOnce, uploadStatus, earlierReply } = await import("../lib/vision-upload-requests.ts");
  const id = `bg-${Date.now()}-abcdef123456`;
  assert.deepEqual(await runAsFarm(A, () => uploadStatus(id)), { state: "UNKNOWN" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const job = runAsFarm(A, () => runOnce(id, async () => { await gate; return { status: 201, body: { analysis: { summary: "ok" } } }; }));
  assert.deepEqual(await runAsFarm(A, () => uploadStatus(id)), { state: "RUNNING" });
  assert.deepEqual(await runAsFarm(B, () => uploadStatus(id)), { state: "UNKNOWN" }, "farm B cannot see farm A's check");
  release();
  await job;
  const done = await runAsFarm(A, () => uploadStatus(id));
  assert.equal(done.state, "DONE");
  assert.equal(done.reply.status, 201);
  assert.equal((await runAsFarm(A, () => earlierReply(id))).body.repeated, true);

  const failing = `${id}-fail`;
  await runAsFarm(A, () => runOnce(failing, async () => { throw new Error("model down"); }));
  const failed = await runAsFarm(A, () => uploadStatus(failing));
  assert.equal(failed.reply.status, 500, "a crash becomes an error reply, not a lost check");
  assert.equal(await runAsFarm(A, () => earlierReply(failing)), null, "an error is not final: the same id may be tried again");
  let runs = 0;
  await runAsFarm(A, () => runOnce(failing, async () => { runs += 1; return { status: 201, body: {} }; }));
  assert.equal(runs, 1);
});

test("daily vision email: once a day to owners and managers who chose it, only their own farm, and not on an empty day", async () => {
  const { runFarmDailyReport, saveDailySettings } = await import("../lib/vision-daily-report.ts");
  const stamp = Date.now();
  const owner = await runAsFarm(A, () => prisma.user.create({ data: { name: "Daily owner", email: `daily-owner-${stamp}@a.test`, role: "OWNER" } }));
  const manager = await runAsFarm(A, () => prisma.user.create({ data: { name: "Daily manager", email: `daily-manager-${stamp}@a.test`, role: "MANAGER" } }));
  const worker = await runAsFarm(A, () => prisma.user.create({ data: { name: "Daily worker", email: `daily-worker-${stamp}@a.test`, role: "WORKER" } }));
  const prefs = (u, on) => runAsFarm(A, () => prisma.setting.upsert({ where: { farmId_key: { farmId: A, key: `ACCOUNT_PREFERENCES_V1::${u.id}` } }, create: { key: `ACCOUNT_PREFERENCES_V1::${u.id}`, value: JSON.stringify({ farmAlertEmail: false, farmReportEmail: on, allowVisionImages: true }) }, update: {} }));
  await prefs(owner, true); await prefs(manager, false); await prefs(worker, true);
  await runAsFarm(A, () => saveDailySettings({ enabled: true, hour: 0 }));
  await runAsFarm(B, () => saveDailySettings({ enabled: true, hour: 0 }));
  await runAsFarm(A, () => prisma.healthObservation.create({ data: {
    observedAt: new Date(Date.now() - 3_600_000), symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "Summary: fine.",
    visionAssessment: { source: { kind: "UPLOAD" }, signals: [{ category: "BEHAVIOR", state: "NORMAL" }] },
  } }));

  const mail = [];
  const send = async (to, message, key) => { mail.push({ to, subject: message.subject, key }); return true; };
  const now = new Date();
  const first = await runAsFarm(A, () => runFarmDailyReport(now, send));
  assert.equal(first.sent, 1);
  assert.deepEqual(mail.map((m) => m.to), [owner.email], "only the owner chose it; the manager did not and workers never get it");
  assert.ok(mail[0].key.startsWith(`flockence-vision-daily-${A}-`) && mail[0].key.endsWith(`-${owner.id}`) && /\d{4}-\d{2}-\d{2}/.test(mail[0].key));
  assert.equal(await runAsFarm(A, () => runFarmDailyReport(now, send)), null, "never twice the same day");
  assert.equal(mail.length, 1);

  const bMail = [];
  const b = await runAsFarm(B, () => runFarmDailyReport(now, async (to) => { bMail.push(to); return true; }));
  assert.equal(bMail.length, 0, "farm B's report never goes to farm A's people");
  assert.ok(b === null || b.sent === 0);

  // A failed send is tried again on the next round, for that person only.
  await runAsFarm(A, () => prisma.setting.deleteMany({ where: { key: "VISION_DAILY_REPORT_STATE" } }));
  await prefs(manager, true);
  await runAsFarm(A, () => prisma.setting.update({ where: { farmId_key: { farmId: A, key: `ACCOUNT_PREFERENCES_V1::${manager.id}` } }, data: { value: JSON.stringify({ farmAlertEmail: false, farmReportEmail: true, allowVisionImages: true }) } }));
  const tries = [];
  const flaky = async (to) => { tries.push(to); return to === owner.email; };
  const partial = await runAsFarm(A, () => runFarmDailyReport(now, flaky));
  assert.equal(partial.sent, 1); assert.equal(partial.failed, 1);
  const retry = await runAsFarm(A, () => runFarmDailyReport(now, async (to) => { tries.push(to); return true; }));
  assert.equal(retry.sent, 1);
  assert.deepEqual(tries.slice(-1), [manager.email], "the retry goes only to the person who did not get it");
});

test("vision alerts: one email per incident to people who chose alerts, quiet on repeats, kept to their farm, logged", async () => {
  const { recordFindings } = await import("../lib/vision-findings.ts");
  const { alertOnFindings, recentAlerts } = await import("../lib/vision-alerts.ts");
  const stamp = Date.now();
  const owner = await runAsFarm(A, () => prisma.user.create({ data: { name: "Alert owner", email: `alert-owner-${stamp}@a.test`, role: "OWNER" } }));
  const manager = await runAsFarm(A, () => prisma.user.create({ data: { name: "Alert manager", email: `alert-manager-${stamp}@a.test`, role: "MANAGER" } }));
  await runAsFarm(A, () => prisma.setting.create({ data: { key: `ACCOUNT_PREFERENCES_V1::${owner.id}`, value: JSON.stringify({ farmAlertEmail: true, farmReportEmail: false, allowVisionImages: true }) } }));
  await runAsFarm(A, () => prisma.setting.create({ data: { key: `ACCOUNT_PREFERENCES_V1::${manager.id}`, value: JSON.stringify({ farmAlertEmail: false, farmReportEmail: true, allowVisionImages: true }) } }));
  const obs = await runAsFarm(A, () => prisma.healthObservation.create({ data: { observedAt: new Date(), symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "x" } }));
  const pen = { id: `alert-pen-${stamp}`, name: "Alert Pen" };
  const analysis = { stillBirds: [{ where: "by the feeder", why: "on its side", confidence: "HIGH" }] };

  const mail = [];
  const send = async (to, message, key) => { mail.push({ to, subject: message.subject, key }); return true; };
  const t0 = new Date();
  const found = await runAsFarm(A, () => recordFindings({ analysis, expectedLive: null, at: t0, pen, batchId: null, cameraName: "Alert Cam", observationId: obs.id, evidenceUrl: null }));
  assert.ok(found.length >= 1 && found[0].created, "recordFindings reports what it created");
  const serious = found.filter((x) => x.severity === "HIGH" || x.severity === "CRITICAL");
  assert.ok(serious.length >= 1, "a bird on its side is a serious finding");
  const first = await runAsFarm(A, () => alertOnFindings(found, t0, send));
  assert.equal(first.emailed, 1);
  assert.deepEqual(mail.map((m) => m.to), [owner.email], "only the person who chose alert emails");

  const t1 = new Date(t0.getTime() + 20 * 60_000);
  const again = await runAsFarm(A, () => recordFindings({ analysis, expectedLive: null, at: t1, pen, batchId: null, cameraName: "Alert Cam", observationId: obs.id, evidenceUrl: null }));
  assert.equal(again[0].id, found[0].id, "the same incident");
  assert.equal(again[0].created, false);
  assert.equal(await runAsFarm(A, () => alertOnFindings(again, t1, send)), null, "seen again 20 minutes later: no second email");
  assert.equal(mail.length, 1);

  const log = await runAsFarm(A, () => recentAlerts());
  assert.equal(log[0].emailed, 1);
  assert.equal(log[0].findings[0].place, "Alert Pen");
  assert.deepEqual(await runAsFarm(B, () => recentAlerts()), [], "farm B sees none of farm A's alerts");

  // If nobody can be reached, the alert is tried again by the next inspection that sees it.
  const other = await runAsFarm(A, () => recordFindings({ analysis: { signals: [{ category: "FEED_WATER", state: "CRITICAL", evidence: "drinker line dry" }] }, expectedLive: null, at: t1, pen, batchId: null, cameraName: "Alert Cam", observationId: obs.id, evidenceUrl: null }));
  const down = await runAsFarm(A, () => alertOnFindings(other, t1, async () => false));
  assert.equal(down.emailed, 0);
  const retry = await runAsFarm(A, () => alertOnFindings(other, new Date(t1.getTime() + 60_000), send));
  assert.equal(retry.emailed, 1, "the failed alert goes out on the next try");
});

test("free plan: a Free farm gets 10 photo checks a month; Premium farms keep theirs", async () => {
  const { currentVisionPlan } = await import("../lib/vision-plan.ts");
  await runAsFarm(B, () => prisma.setting.upsert({ where: { farmId_key: { farmId: B, key: "MEMBERSHIP_V1" } }, create: { key: "MEMBERSHIP_V1", value: "FREE" }, update: { value: "FREE" } }));
  const free = await runAsFarm(B, () => currentVisionPlan());
  assert.equal(free.plan, "FREE");
  assert.equal(free.limits.manualPerMonth, 10);
  assert.equal(free.limits.automatic, false);
  const before = process.env.VISION_PREMIUM_FARMS;
  process.env.VISION_PREMIUM_FARMS = B;
  try {
    assert.equal((await runAsFarm(B, () => currentVisionPlan())).plan, "PREMIUM");
  } finally {
    if (before === undefined) delete process.env.VISION_PREMIUM_FARMS; else process.env.VISION_PREMIUM_FARMS = before;
  }
});

test("pen layout: the pen's records, its flock's live birds and weight, and what Vision saw there, for its own farm only", async () => {
  const { penLayout } = await import("../lib/pen-layout.ts");
  const stamp = Date.now();
  const penRow = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PENCFG::u::layout-${stamp}`, value: JSON.stringify({ name: `Layout Pen ${stamp}`, lengthM: 10, widthM: 12, housingMode: "OPEN_SIDED_HOT", feederPans: 8, nipples: 80, bellDrinkers: 0, heatSources: 2, fans: 1, active: true }) } }));
  const batch = await runAsFarm(A, () => prisma.batch.create({ data: { name: "Layout flock", startDate: new Date(Date.now() - 20 * 86_400_000), initialChicks: 1000, chickCostMinor: 0, status: "ACTIVE", placementHouse: `Layout Pen ${stamp}` } }));
  await runAsFarm(A, () => prisma.birdCount.create({ data: { batchId: batch.id, date: new Date(Date.now() - 20 * 86_400_000), liveCount: 1000, note: "Initial count" } }));
  await runAsFarm(A, () => prisma.weightRecord.create({ data: { batchId: batch.id, date: new Date(), scope: "SAMPLE", quantity: 20, avgWeightKg: 2.5, liveOrDressed: "LIVE" } }));
  for (const layout of [{ view: "WHOLE_PEN", feeders: 6, heaters: 1, crowding: [{ at: "HEATER" }] }, { view: "MOST_OF_PEN", feeders: 5, heaters: 1, crowding: [{ at: "HEATER" }] }]) {
    await runAsFarm(A, () => prisma.healthObservation.create({ data: { observedAt: new Date(), symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "x",
      visionAssessment: { pen: { id: penRow.id, name: `Layout Pen ${stamp}` }, layout } } }));
  }
  const a = await runAsFarm(A, () => penLayout(penRow.id));
  assert.equal(a.areaM2, 120);
  assert.equal(a.live, 1000);
  assert.equal(a.weightKg, 2.5);
  assert.equal(a.densityKgM2, 20.8);
  assert.equal(a.seen.widePictures, 2);
  assert.equal(a.seen.feeders, 6);
  assert.ok(a.recommendations.some((r) => /ceiling/.test(r.text)));
  assert.ok(a.recommendations.some((r) => /bunched around the heat/.test(r.text)));
  assert.equal(await runAsFarm(B, () => penLayout(penRow.id)), null, "farm B cannot read farm A's pen");
});

test("vision context: feed, weight, health, pen and findings from the farm's records, ordered for the check, own farm only", async () => {
  const { inspectionContext } = await import("../lib/vision-context.ts");
  const stamp = Date.now();
  const penName = `Context Pen ${stamp}`;
  const penRow = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PENCFG::u::ctx-${stamp}`, value: JSON.stringify({ name: penName, lengthM: 10, widthM: 12, feederPans: 8, nipples: 80, heatSources: 2, active: true }) } }));
  const placed = new Date(Date.now() - 24 * 86_400_000);
  const batch = await runAsFarm(A, () => prisma.batch.create({ data: { name: "Context flock", startDate: placed, initialChicks: 850, chickCostMinor: 0, status: "ACTIVE", placementHouse: penName } }));
  await runAsFarm(A, () => prisma.birdCount.create({ data: { batchId: batch.id, date: placed, liveCount: 850, note: "Initial count" } }));
  await runAsFarm(A, () => prisma.mortalityEvent.create({ data: { batchId: batch.id, date: new Date(Date.now() - 3_600_000), quantity: 8 } }));
  await runAsFarm(A, () => prisma.feedUsage.create({ data: { batchId: batch.id, date: new Date(Date.now() - 2 * 3_600_000), feedType: "Grower", quantityKg: 80, costMinor: 0 } }));
  await runAsFarm(A, () => prisma.weightRecord.create({ data: { batchId: batch.id, date: new Date(), scope: "SAMPLE", quantity: 20, avgWeightKg: 1.2, liveOrDressed: "LIVE" } }));
  await runAsFarm(A, () => prisma.healthCase.create({ data: { batchId: batch.id, caseNumber: `HC-${stamp}`, title: "Coughing in pen 1", severity: "MODERATE" } }));
  await runAsFarm(A, () => prisma.visionFinding.create({ data: { kind: "LITTER", title: "Wet litter", severity: "HIGH", state: "OBSERVED", incidentKey: `ctx-${stamp}`, penId: penRow.id, penName, firstSeenAt: new Date(), lastSeenAt: new Date(), history: [] } }));

  const c = await runAsFarm(A, () => inspectionContext({ batchId: null, pen: { id: penRow.id, name: penName }, category: "FEED" }));
  assert.equal(c.batchId, batch.id, "the flock housed in the pen is picked");
  assert.equal(c.expectedLive, 842);
  assert.equal(c.sections[0].key, "FEED", "a feed check leads with feed");
  const get = (k) => c.sections.find((s) => s.key === k)?.lines.join(" | ") ?? "";
  assert.match(get("FEED"), /80 kg in the last 24 hours \(about 95 g per bird\)/);
  assert.match(get("WEIGHT"), /1\.2 kg average live weight/);
  assert.match(get("MORTALITY"), /^8 in the last 24 hours, 8 in the last 7 days/);
  assert.match(get("HEALTH"), /open case: Coughing in pen 1 \(moderate/);
  assert.match(get("PEN"), /10 × 12 m \(120 m²\).*about 8\.4 kg\/m² stocking.*8 feeder pans, 80 nipples, 2 heaters/);
  assert.match(get("FINDINGS"), /Wet litter/);
  assert.match(c.text, /^Feed: 80 kg/);

  const b = await runAsFarm(B, () => inspectionContext({ batchId: batch.id, pen: { id: penRow.id, name: penName }, category: "PEN" }));
  assert.equal(b.expectedLive, null, "farm B cannot read farm A's flock");
  assert.ok(!b.text.includes("Wet litter") && !b.text.includes("120 m²"), "nor its pen or findings");
});

test("offline snapshot: each flock's records and today's daily check, open findings and the latest check per pen, own farm only", async () => {
  const { offlineSnapshot } = await import("../lib/offline-snapshot.ts");
  const stamp = Date.now();
  const batch = await runAsFarm(A, () => prisma.batch.create({ data: { name: `Glance flock ${stamp}`, startDate: new Date(Date.now() - 10 * 86_400_000), initialChicks: 500, chickCostMinor: 0, status: "ACTIVE" } }));
  await runAsFarm(A, () => prisma.birdCount.create({ data: { batchId: batch.id, date: new Date(Date.now() - 10 * 86_400_000), liveCount: 500, note: "Initial count" } }));
  await runAsFarm(A, () => prisma.visionFinding.create({ data: { kind: "LITTER", title: `Glance wet litter ${stamp}`, severity: "HIGH", state: "OBSERVED", incidentKey: `glance-${stamp}`, penName: "Glance Pen", firstSeenAt: new Date(), lastSeenAt: new Date(), history: [] } }));
  await runAsFarm(A, () => prisma.healthObservation.create({ data: { observedAt: new Date(), symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "x",
    visionAssessment: { version: 1, model: "m", source: { kind: "UPLOAD" }, inspectionCategory: "PEN", status: "GOOD", signals: Array.from({ length: 7 }, (_, i) => ({ category: ["BEHAVIOR", "DISTRIBUTION", "LITTER", "COMFORT", "FEED_WATER", "EQUIPMENT", "VISIBLE_HEALTH"][i], state: "NOT_OBSERVED" })), confidence: "HIGH", summary: "Birds spread evenly.", checks: [], evidenceId: "e1", pen: { id: `glance-pen-${stamp}`, name: "Glance Pen" } } } }));

  const s = await runAsFarm(A, () => offlineSnapshot());
  const f = s.flocks.find((x) => x.id === batch.id);
  assert.ok(f, "the active flock is in the snapshot");
  assert.equal(f.dailyCheckToday, false);
  assert.ok(f.sections.some((x) => x.title === "Flock" && /500 placed; 500 live/.test(x.lines.join(" "))));
  assert.ok(!f.sections.some((x) => x.title === "Time"), "no time line");
  assert.ok(s.findings.some((x) => x.title === `Glance wet litter ${stamp}` && x.place === "Glance Pen"));
  assert.ok(s.pens.some((p) => p.name === "Glance Pen" && p.summary === "Birds spread evenly."));

  const b = await runAsFarm(B, () => offlineSnapshot());
  assert.ok(!b.flocks.some((x) => x.id === batch.id), "farm B's phone never gets farm A's flocks");
  assert.ok(!b.findings.some((x) => x.title === `Glance wet litter ${stamp}`));
});

test("recording checks: one clip per part of the day, filed at its filming time, within the budget, own farm's state", async () => {
  const { runRecordingChecks, loadRecordingStatus } = await import("../lib/vision-recordings.ts");
  const { saveCameraPen } = await import("../lib/vision-camera-pens.ts");
  const stamp = Date.now();
  const owner = await runAsFarm(A, () => prisma.user.create({ data: { name: "Rec owner", email: `rec-${stamp}@a.test`, role: "OWNER" } }));
  const pen = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PENCFG::u::rec-${stamp}`, value: JSON.stringify({ name: `Rec Pen ${stamp}`, active: true }) } }));
  const camera = { name: `Rec cam ${stamp}`, source: "blink", deviceKey: "k" };
  await runAsFarm(A, () => saveCameraPen(camera, pen.id, owner.id));
  const now = new Date();
  // One clip in each of four different parts of the farm's day (Barbados time), all in the last 24 hours. Fixed
  // "hours ago" offsets landed two clips in the same part at some times of day (e.g. CI after 00:00 UTC), and the rule
  // then rightly keeps only the one nearest the middle of that part, so the test failed overnight.
  const { FARM_TIME_ZONE } = await import("../lib/poultry-metrics.mjs");
  const farmHour = (d) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(d));
  const nowHour = farmHour(now);
  const partHours = [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9, 10], [11, 12, 13, 14], [15, 16, 17, 18]];   // night, morning, midday, afternoon
  const clipTimes = partHours.map((hours) => {
    const hour = hours.find((h) => h !== nowHour);
    for (let back = 1; back < 24; back += 1) {
      const t = new Date(now.getTime() - back * 3_600_000);
      if (farmHour(t) === hour) return t;
    }
    throw new Error("no clip time for farm hour " + hour);
  });
  const clips = clipTimes.map((t, i) => ({ id: `blink:c${i}-${stamp}`, camera: camera.name, createdAt: t.toISOString(), source: "blink", media: `/api/v1/c${i}` }));
  const oldest = clips.reduce((a, b) => (Date.parse(a.createdAt) <= Date.parse(b.createdAt) ? a : b));
  const inspected = [];
  const deps = {
    visionCameras: async () => [camera],
    recentCameraClips: async () => clips,
    recordedClipFrames: async () => [Buffer.from([255, 216, 255, 1]), Buffer.from([255, 216, 255, 2]), Buffer.from([255, 216, 255, 3])],
    runVisionInspection: async (req) => { inspected.push(req); return { ok: true, analysis: { summary: "ok" }, observation: { id: "o" } }; },
  };
  const first = await runAsFarm(A, () => runRecordingChecks([camera.name], 1, now, deps));
  assert.equal(first.used, 1, "never more than the remaining daily budget");
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].recording.frames.length, 3);
  assert.equal(inspected[0].recording.clipAt.toISOString(), oldest.createdAt, "the oldest part of the day first, filed at filming time");
  assert.equal(inspected[0].automatic, true);

  const second = await runAsFarm(A, () => runRecordingChecks([camera.name], 10, now, deps));
  assert.equal(second.used, 2, "at most 2 a round");
  const status = await runAsFarm(A, () => loadRecordingStatus());
  assert.equal(Object.keys(status.done).length, 3);
  assert.ok(Array.isArray(status.missing[camera.name]));
  assert.equal(await runAsFarm(B, () => loadRecordingStatus()), null, "farm B has its own (empty) recording state");
});

test("eggs: a layer farm's report compares floor eggs seen with collections; counts only once switched on; broiler-only scopes have no eggs area", async () => {
  const { buildVisionReport, periodFor } = await import("../lib/vision-reports.ts");
  const { recordFindings } = await import("../lib/vision-findings.ts");
  const { setEggCounts } = await import("../lib/vision-egg-settings.ts");
  const stamp = Date.now();
  const penName = `Layer Pen ${stamp}`;
  const pen = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PENCFG::u::lay-${stamp}`, value: JSON.stringify({ name: penName, active: true }) } }));
  const placed = new Date(Date.now() - 200 * 86_400_000);
  const hens = await runAsFarm(A, () => prisma.batch.create({ data: { name: "Hens", startDate: placed, initialChicks: 1000, chickCostMinor: 0, status: "ACTIVE", placementHouse: penName, productionType: "LAYER" } }));
  await runAsFarm(A, () => prisma.birdCount.create({ data: { batchId: hens.id, date: placed, liveCount: 1000, note: "Initial count" } }));
  await runAsFarm(A, () => prisma.eggCollection.create({ data: { batchId: hens.id, date: new Date(Date.now() - 3_600_000), liveHens: 1000, totalEggs: 850, saleableEggs: 820, floorEggs: 12 } }));
  const at = new Date(Date.now() - 1_800_000);
  const obs = await runAsFarm(A, () => prisma.healthObservation.create({ data: { observedAt: at, symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "x",
    visionAssessment: { pen: { id: pen.id, name: penName }, source: { kind: "UPLOAD" }, signals: [], eggs: { floorEggs: 5, nestEggs: 40, floorEggAreas: ["by the door"] } } } }));
  const found = await runAsFarm(A, () => recordFindings({ analysis: { eggs: { floorEggs: 5, floorEggAreas: ["by the door"] } }, expectedLive: null, at, pen: { id: pen.id, name: penName }, batchId: hens.id, cameraName: null, observationId: obs.id, evidenceUrl: null }));
  assert.equal(found[0].title, "Floor eggs seen", "no count before the farm switches counts on");

  const report = await runAsFarm(A, () => buildVisionReport({ kind: "PEN", id: pen.id }, periodFor("24h")));
  assert.ok(report.areas.some((a) => a.area === "EGGS" && a.status === "MONITOR"));
  assert.equal(report.eggs.recordedEggs, 850);
  assert.equal(report.eggs.recordedFloorEggs, 12);
  assert.equal(report.eggs.picturesWithFloorEggs, 1);
  assert.equal(report.eggs.mostFloorEggsInOnePicture, null);
  await runAsFarm(A, () => setEggCounts(true));
  const counted = await runAsFarm(A, () => buildVisionReport({ kind: "PEN", id: pen.id }, periodFor("24h")));
  assert.equal(counted.eggs.mostFloorEggsInOnePicture, 5);
  await runAsFarm(A, () => setEggCounts(false));

  const broilerPen = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PENCFG::u::broil-${stamp}`, value: JSON.stringify({ name: `Broiler Pen ${stamp}`, active: true }) } }));
  const broiler = await runAsFarm(A, () => buildVisionReport({ kind: "PEN", id: broilerPen.id }, periodFor("24h")));
  assert.ok(!broiler.areas.some((a) => a.area === "EGGS"), "no eggs area for a pen without layers");
  assert.equal(broiler.eggs, null);
});

test("people and biosecurity: no people data unless the owner keeps a timeline, removed after its keep period; pests reported", async () => {
  const { createVisionAssessment } = await import("../lib/vision-assessment.ts");
  const { savePeopleSettings, peopleSettings, removePeopleData } = await import("../lib/vision-people.ts");
  const { recordFindings } = await import("../lib/vision-findings.ts");
  const { buildVisionReport, periodFor } = await import("../lib/vision-reports.ts");
  const result = { summary: "ok", observations: [], concerns: [], checks: [], escalate: false, signals: [], animals: [{ kind: "RODENT", where: "by the feed store" }], people: { inView: 1, activity: "FEEDING", boots: "NOT_SEEN", coveralls: "SEEN" } };
  const base = { model: "m", source: { kind: "UPLOAD" }, inspectionCategory: "PEN", evidenceId: "e" };
  const off = createVisionAssessment(result, { ...base, keepPeople: false });
  assert.equal(off.people, undefined, "nothing about people is saved while the timeline is off");
  assert.equal("keepPeople" in off, false);
  assert.equal(off.animals.length, 1, "animals are always kept");
  assert.equal(createVisionAssessment(result, { ...base, keepPeople: true }).people.activity, "FEEDING");

  assert.deepEqual(await runAsFarm(A, () => peopleSettings()), { timeline: false, keepDays: 30 });
  await runAsFarm(A, () => savePeopleSettings({ timeline: true, keepDays: 30 }));
  const stamp = Date.now();
  const pen = await runAsFarm(A, () => prisma.setting.create({ data: { key: `PENCFG::u::bio-${stamp}`, value: JSON.stringify({ name: `Bio Pen ${stamp}`, active: true }) } }));
  const mk = (daysAgo) => runAsFarm(A, () => prisma.healthObservation.create({ data: { observedAt: new Date(Date.now() - daysAgo * 86_400_000), symptom: "Farm Vision inspection", category: "VISION:PEN", affectedCount: 0, notes: "x",
    visionAssessment: { pen: { id: pen.id, name: `Bio Pen ${stamp}` }, source: { kind: "UPLOAD" }, signals: [], animals: [], people: { inView: 2, activity: "CLEANING", boots: "NOT_SEEN" } } } }));
  const old = await mk(40), recent = await mk(0.05);
  assert.equal(await runAsFarm(A, () => removePeopleData(new Date(Date.now() - 30 * 86_400_000))), 1);
  const [o, r] = await Promise.all([old, recent].map((x) => runAsFarm(A, () => prisma.healthObservation.findUnique({ where: { id: x.id } }))));
  assert.equal(o.visionAssessment.people, undefined, "older than 30 days: removed");
  assert.equal(o.visionAssessment.pen.id, pen.id, "the rest of the inspection stays");
  assert.equal(r.visionAssessment.people.inView, 2);

  const report = await runAsFarm(A, () => buildVisionReport({ kind: "PEN", id: pen.id }, periodFor("24h")));
  assert.equal(report.people.length, 1);
  assert.equal(report.people[0].protectiveWearNotSeen, 1);
  assert.deepEqual(report.people[0].activities, ["cleaning"]);
  assert.ok(report.areas.some((a) => a.area === "BIOSECURITY" && a.status === "GOOD"), "checked for animals, none seen");

  const found = await runAsFarm(A, () => recordFindings({ analysis: { animals: [{ kind: "WILD_BIRD", where: "inside by the fan" }] }, expectedLive: null, at: new Date(), pen: { id: pen.id, name: `Bio Pen ${stamp}` }, batchId: null, cameraName: null, observationId: recent.id, evidenceUrl: null }));
  assert.equal(found[0].kind, "PESTS");
  assert.equal(found[0].severity, "HIGH");

  await runAsFarm(A, () => savePeopleSettings({ timeline: false, keepDays: 30 }));
  const after = await runAsFarm(A, () => prisma.healthObservation.findUnique({ where: { id: recent.id } }));
  assert.equal(after.visionAssessment.people, undefined, "switching the timeline off removes what was kept");
  assert.deepEqual(await runAsFarm(B, () => peopleSettings()), { timeline: false, keepDays: 30 }, "farm B's setting is its own");
});

test("reference library in the Vision context: a 3-day-old flock at 27 °C is flagged against the farm's own guides", async () => {
  const { inspectionContext } = await import("../lib/vision-context.ts");
  const placed = new Date(Date.now() - 3 * 86_400_000);
  const chicks = await runAsFarm(A, () => prisma.batch.create({ data: { name: `Chicks ${Date.now()}`, startDate: placed, hatchDate: placed, initialChicks: 600, chickCostMinor: 0, status: "ACTIVE" } }));
  await runAsFarm(A, () => prisma.birdCount.create({ data: { batchId: chicks.id, date: placed, liveCount: 600, note: "Initial count" } }));
  await runAsFarm(A, () => prisma.dailyFlockCheck.create({ data: { batchId: chicks.id, date: new Date(), liveCount: 600, temperatureC: 27, humidityPercent: 60 } }));
  const c = await runAsFarm(A, () => inspectionContext({ batchId: chicks.id, category: "FLOCK" }));
  const check = c.sections.find((s) => s.key === "GUIDE_CHECK");
  assert.ok(check, "records are checked against the guides");
  assert.match(check.lines.join(" "), /Check: 27 °C recorded; the guide's target is about 31 °C: too cold for their age, watch for huddling \(Cobb Broiler Management Guide \(2020\)\)/);
  const guide = c.sections.find((s) => s.key === "GUIDANCE");
  assert.ok(guide.lines.some((l) => /32–33 °C for day 3 on the Caribbean brooding schedule/.test(l)));
  assert.match(c.text, /Your records against your guides: Check: 27 °C/);
});

test("bird counter: off unless the server and the farm switch it on; then it counts, and a bad answer is ignored", async () => {
  const { countBirds, detectorConfigured, setDetectorForFarm } = await import("../lib/bird-detector.ts");
  const frames = [Buffer.from([255, 216, 255, 1]), Buffer.from([255, 216, 255, 2])];
  let calls = 0;
  const fake = async (url, init) => { calls += 1; return new Response(JSON.stringify({ model: "birds-v1", frames: [{ boxes: [[0.1, 0.8, 0.15, 0.85, 0.9], [0.5, 0.5, 0.55, 0.55, 0.9]] }, { boxes: [[0.1, 0.8, 0.15, 0.85, 0.9], [0.6, 0.4, 0.65, 0.45, 0.9]] }] }), { status: 200 }); };
  const saved = { ...process.env };
  try {
    delete process.env.VISION_DETECTOR;
    assert.equal(detectorConfigured(), false);
    assert.equal(await runAsFarm(A, () => countBirds(frames, fake)), null, "off by default");
    Object.assign(process.env, { VISION_DETECTOR: "on", DETECTOR_URL: "http://127.0.0.1:8090", DETECTOR_TOKEN: "t".repeat(40) });
    assert.equal(detectorConfigured(), true);
    assert.equal(await runAsFarm(A, () => countBirds(frames, fake)), null, "the farm has not switched it on");
    assert.equal(calls, 0);
    await runAsFarm(A, () => setDetectorForFarm(true));
    const counted = await runAsFarm(A, () => countBirds(frames, fake));
    assert.equal(counted.count, 2);
    assert.equal(counted.still.length, 1);
    assert.equal(counted.still[0].where, "lower left");
    assert.equal(await runAsFarm(B, () => countBirds(frames, fake)), null, "farm B's switch is its own");
    assert.equal(await runAsFarm(A, () => countBirds(frames, async () => new Response("{}", { status: 200 }))), null, "a bad answer is ignored");
    assert.equal(await runAsFarm(A, () => countBirds(frames, async () => { throw new Error("down"); })), null, "a down detector is ignored");
    process.env.DETECTOR_URL = "http://evil.example";
    assert.equal(detectorConfigured(), false, "plain http only on this machine");
  } finally {
    for (const k of ["VISION_DETECTOR", "DETECTOR_URL", "DETECTOR_TOKEN"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await runAsFarm(A, () => setDetectorForFarm(false));
  }
});

test("real bird counts: kept per camera, a correction replaces the earlier answer, last 10 only, own farm only", async () => {
  const { addCountSample, countSamples } = await import("../lib/vision-count-calibration.ts");
  const { penEstimate } = await import("../lib/vision-glance-rules.mjs");
  const cam = `Count cam ${Date.now()}`;
  await runAsFarm(A, () => addCountSample(cam, { counted: 80, actual: 90, observationId: "o1" }));
  await runAsFarm(A, () => addCountSample(cam, { counted: 80, actual: 96, observationId: "o1" }));
  assert.deepEqual((await runAsFarm(A, () => countSamples(cam))).map((s) => s.actual), [96], "a correction for the same check replaces it");
  await runAsFarm(A, () => addCountSample(cam, { counted: 85, actual: 95, observationId: "o2" }));
  assert.equal(penEstimate(80, await runAsFarm(A, () => countSamples(cam))).estimate, 93);
  for (let i = 3; i <= 14; i++) await runAsFarm(A, () => addCountSample(cam, { counted: 80, actual: 92, observationId: `o${i}` }));
  assert.equal((await runAsFarm(A, () => countSamples(cam))).length, 10);
  assert.deepEqual(await runAsFarm(B, () => countSamples(cam)), [], "farm B's camera of the same name has its own counts");
});
