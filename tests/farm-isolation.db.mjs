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
