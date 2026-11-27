import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const adminUrl = new URL(process.env.DATABASE_URL);
const gatewayUrl = new URL(process.env.CAMERA_GATEWAY_DATABASE_URL);
const deviceUrl = new URL(process.env.DEVICE_GATEWAY_DATABASE_URL);
assert.match(adminUrl.pathname, /^\/[A-Za-z0-9_]+_test$/);
assert.equal(adminUrl.hostname, "localhost");
assert.equal(gatewayUrl.host + gatewayUrl.pathname, adminUrl.host + adminUrl.pathname);
assert.equal(gatewayUrl.username, "flockence_camera_gateway");
assert.equal(deviceUrl.host + deviceUrl.pathname, adminUrl.host + adminUrl.pathname);
assert.equal(deviceUrl.username, "flockence_device_gateway");

const { prisma } = await import("../lib/prisma.ts");
const { runAsFarm } = await import("../lib/farm-scope.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/auth.ts");
const restricted = new PrismaClient({ datasourceUrl: gatewayUrl.toString() });
const deviceDb = new PrismaClient({ datasourceUrl: deviceUrl.toString() });
const origin = "http://127.0.0.1:3101";
const farms = ["gateway-ci-a", "gateway-ci-b"];
let app;

async function seed(farmId, index, role) {
  return runAsFarm(farmId, async () => {
    const user = await prisma.user.create({
      data: { farmId, name: "Disposable camera test", email: "gateway-ci-" + index + "@example.test", role },
    });
    const { token } = await createSession(user.id);
    return SESSION_COOKIE + "=" + encodeURIComponent(token);
  });
}

try {
  for (const farmId of farms) {
    await runAsFarm(farmId, async () => {
      await prisma.farm.create({ data: { id: farmId, name: farmId } });
      await prisma.setting.create({ data: { farmId, key: "GATEWAY_PRIVATE_TEST", value: "Must remain private" } });
    });
  }
  const [ownerA, ownerB, worker] = await Promise.all([
    seed(farms[0], 0, "OWNER"), seed(farms[1], 1, "OWNER"), seed(farms[0], 2, "WORKER"),
  ]);
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3101"], {
    stdio: "inherit", env: { ...process.env, APP_URL: origin },
  });
  let ready = false;
  for (let i = 0; i < 25; i++) {
    const response = await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) { ready = true; break; }
    await sleep(500);
  }
  assert.ok(ready);
  const gateway = origin + "/api/camera-gateway";
  const create = (cookie, brand, requestOrigin = origin) => fetch(gateway, {
    method: "POST", headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: brand + " barn", brand }),
  });
  assert.equal((await create(ownerA, "wyze", "https://other.example")).status, 403);
  assert.equal((await create(worker, "wyze")).status, 403);
  const all = await Promise.all([create(ownerA, "wyze"), create(ownerB, "network")]);
  if (all.some((response) => response.status !== 201)) {
    console.error("Create statuses:", all.map((response) => response.status));
  }
  assert.deepEqual(all.map((response) => response.status), [201, 201]);
  const [a, b] = await Promise.all(all.map((response) => response.json()));
  assert.match(a.token, /^cg1\.gateway-ci-a\./);
  assert.match(b.token, /^cg1\.gateway-ci-b\./);

  const list = async (cookie) => (await fetch(gateway, { headers: { Cookie: cookie } })).json();
  const [listA, listB] = await Promise.all([list(ownerA), list(ownerB)]);
  assert.deepEqual(listA.feeds.map(({ id }) => id), [a.id]);
  assert.deepEqual(listB.feeds.map(({ id }) => id), [b.id]);
  assert.equal(JSON.stringify(listA).includes(a.token), false);
  assert.deepEqual(await restricted.setting.findMany(), []);
  for (const [index, feed] of [a, b].entries()) {
    const rows = await restricted.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.farm_id', ${farms[index]}, true)`;
      return tx.setting.findMany();
    });
    assert.deepEqual(rows.map(({ key }) => key), ["CAMERA_GATEWAY::" + feed.id]);
    assert.equal(JSON.stringify(rows).includes(feed.token), false);
  }
  assert.deepEqual(await restricted.setting.findMany(), []);

  await assert.rejects(restricted.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.farm_id', ${farms[0]}, true)`;
    await tx.setting.create({ data: { farmId: farms[0], key: "GATEWAY_UNRELATED_WRITE_TEST", value: "Forbidden" } });
  }), /row-level security policy/i);

  const image = Buffer.from([255, 216, 255, 224, 0, 4, 1, 2, 255, 217]);
  const frame = (feed) => gateway + "/" + feed.id + "/frame";
  const captured = new Date().toISOString();
  const push = (destination, token, body = image) => fetch(frame(destination), {
    method: "PUT", body,
    headers: { Authorization: "Bearer " + token, "Content-Type": "image/jpeg", "X-Captured-At": captured },
  });
  assert.equal((await push(b, a.token)).status, 401);
  assert.equal((await push(a, a.token.replace("gateway-ci-a", "gateway-ci-b"))).status, 401);
  assert.equal((await push(a, a.token, Buffer.alloc(256 * 1024 + 1))).status, 413);
  assert.equal((await push(a, a.token)).status, 201);
  assert.equal((await push(a, a.token)).status, 409);
  assert.equal((await fetch(frame(a), { headers: { Cookie: ownerB } })).status, 404);
  assert.equal((await fetch(frame(a))).status, 401);

  const photo = await fetch(frame(a), { headers: { Cookie: ownerA } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/jpeg");
  assert.ok(photo.headers.get("cache-control")?.split(",").some((directive) => directive.trim() === "no-store"));
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), image);
  const saved = await runAsFarm(farms[0], () => prisma.setting.findFirstOrThrow({ where: { key: "CAMERA_GATEWAY::" + a.id } }));
  assert.equal(saved.value.includes(image.toString("base64")), false);
  assert.equal((await fetch(frame(a), { method: "DELETE", headers: { Cookie: ownerB, Origin: origin } })).status, 404);
  assert.equal((await fetch(frame(a), { method: "DELETE", headers: { Cookie: ownerA, Origin: origin } })).status, 200);
  assert.equal((await push(a, a.token)).status, 401);
  const wyze = gateway + "/wyze";
  const pair = (cookie, requestOrigin = origin) => fetch(wyze, {
    method: "POST", headers: { Cookie: cookie, Origin: requestOrigin },
  });
  assert.equal((await pair(worker)).status, 403);
  assert.equal((await pair(ownerA, "https://other.example")).status, 403);
  const firstPair = await pair(ownerA);
  assert.equal(firstPair.status, 201);
  const { token: pairing } = await firstPair.json();
  assert.match(pairing, /^wb1\.gateway-ci-a\./);
  const discover = (token, cameras) => fetch(wyze, {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ cameras }),
  });
  const discoveredCamera = { device: "a".repeat(64), name: "Wyze Brooder" };
  assert.equal((await discover(pairing.replace("gateway-ci-a", "gateway-ci-b"), [discoveredCamera])).status, 401);
  assert.equal((await discover(pairing, [discoveredCamera, discoveredCamera])).status, 400);
  const discovery = await discover(pairing, [discoveredCamera]);
  assert.equal(discovery.status, 200);
  const [wyzeFeed] = (await discovery.json()).feeds;
  const rename = await discover(pairing, [{ ...discoveredCamera, name: "Wyze Hatchery" }]);
  assert.equal((await rename.json()).feeds[0].id, wyzeFeed.id);
  const { feeds: wyzeA } = await list(ownerA);
  assert.deepEqual(wyzeA.map(({ id, name, brand }) => ({ id, name, brand })), [
    { id: wyzeFeed.id, name: "Wyze Hatchery", brand: "wyze" },
  ]);
  assert.equal((await list(ownerB)).feeds.some(feed => feed.id === wyzeFeed.id), false);
  assert.equal((await push(b, pairing)).status, 401);
  assert.equal((await push(wyzeFeed, pairing)).status, 201);
  assert.equal((await fetch(frame(wyzeFeed), { headers: { Cookie: ownerB } })).status, 404);
  const state = await fetch(wyze, { headers: { Cookie: ownerA } }).then(response => response.json());
  assert.equal(state.seen, 1);
  assert.equal(typeof state.lastSync, "string");
  assert.equal(JSON.stringify(state).includes(pairing), false);
  const { token: rotated } = await (await pair(ownerA)).json();
  assert.equal((await discover(pairing, [discoveredCamera])).status, 401);
  assert.equal((await push(wyzeFeed, pairing)).status, 401);
  assert.equal((await discover(rotated, [discoveredCamera])).status, 200);
  assert.equal((await fetch(wyze, { method: "DELETE", headers: { Cookie: ownerA, Origin: origin } })).status, 200);
  assert.equal((await push(wyzeFeed, rotated)).status, 401);
  console.log("Gateway isolation, encrypted snapshots, owner permissions and revocation passed.");

  // The same already-authenticated farm sessions can use the Devices workspace.
  const devicesUrl = origin + "/api/device-gateways";
  const deviceHeaders = (cookie) => ({ Cookie: cookie, Origin: origin, "Content-Type": "application/json" });
  assert.equal((await fetch(origin + "/devices", { headers: { Cookie: ownerA } })).status, 200);
  assert.equal((await fetch(devicesUrl)).status, 401);
  const link = (cookie) => fetch(devicesUrl, {
    method: "POST", headers: deviceHeaders(cookie), body: JSON.stringify({ name: "Barn devices" }),
  });
  assert.equal((await link(worker)).status, 403);
  const created = await link(ownerA);
  assert.equal(created.status, 201);
  const edge = await created.json();
  assert.equal(typeof edge.token, "string");
  const edgePath = devicesUrl + "/" + edge.id;
  const data = {
    observedAt: new Date().toISOString(),
    devices: [
      { id: "barn-temp", name: "Barn temperature", kind: "temperature", value: 27.3 },
      { id: "water-leak", name: "Water leak sensor", kind: "leak", value: "off" },
    ],
  };
  const send = (token, reading = data) => fetch(edgePath, {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(reading),
  });
  assert.equal((await send(edge.token.replace("gateway-ci-a", "gateway-ci-b"))).status, 401);
  assert.equal((await send(edge.token, { ...data, devices: [...data.devices, data.devices[0]] })).status, 400);
  assert.equal((await send(edge.token)).status, 201);
  assert.equal((await send(edge.token)).status, 409);

  const listDevices = async (cookie) => {
    const response = await fetch(devicesUrl, { headers: { Cookie: cookie, "X-Flockence-Farm": farms[0] } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const [devicesA, devicesB] = await Promise.all([listDevices(ownerA), listDevices(ownerB)]);
  assert.deepEqual(devicesA.links[0].devices, data.devices);
  assert.deepEqual(devicesB.links, []);
  assert.equal(JSON.stringify(devicesA).includes(edge.token), false);
  assert.deepEqual(await deviceDb.setting.findMany(), []);
  const ownRows = await deviceDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.farm_id', ${farms[0]}, true)`;
    return tx.setting.findMany();
  });
  assert.deepEqual(ownRows.map(({ key }) => key), ["SMART_DEVICE_GATEWAY::" + edge.id]);
  assert.equal(ownRows[0].value.includes(edge.token), false);
  assert.equal(ownRows[0].value.includes("Barn temperature"), false);
  await assert.rejects(deviceDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.farm_id', ${farms[0]}, true)`;
    await tx.setting.create({ data: { farmId: farms[0], key: "CAMERA_GATEWAY::blocked", value: "Forbidden" } });
  }), /row-level security policy/i);
  assert.equal((await fetch(edgePath, { method: "DELETE", headers: deviceHeaders(ownerB) })).status, 404);
  assert.equal((await fetch(edgePath, { method: "DELETE", headers: deviceHeaders(ownerA) })).status, 200);
  assert.equal((await send(edge.token)).status, 401);
  console.log("Shared sessions, smart device isolation, encrypted state, and revocation passed.");

  const authUrl = origin + "/api/auth/sessions";
  const meUrl = origin + "/api/auth/me";
  const cookieFor = (token) => SESSION_COOKIE + "=" + encodeURIComponent(token);
  const owner = await runAsFarm(farms[0], () => prisma.user.findUniqueOrThrow({ where: { email: "gateway-ci-0@example.test" } }));
  const expectedExpiry = Date.now() + 15 * 60_000;
  const issueLegacy = async (signedFarm) => {
    const legacyBody = Buffer.from(JSON.stringify({
      userId: owner.id, expiresAt: expectedExpiry, nonce: signedFarm ?? "legacy-compatibility",
      ...(signedFarm ? { farmId: signedFarm } : {}),
    })).toString("base64url");
    const token = legacyBody + "." + createHmac("sha256", process.env.AUTH_SECRET).update(legacyBody).digest("base64url");
    const key = "AUTH_SESSION::" + createHash("sha256").update(token).digest("hex");
    await runAsFarm(farms[0], () => prisma.setting.create({
      data: { key, farmId: farms[0], value: JSON.stringify({ userId: owner.id, expiresAt: new Date(expectedExpiry).toISOString() }) },
    }));
    return { token, key };
  };

  const legacy = await issueLegacy();
  assert.equal((await fetch(meUrl, { headers: { Cookie: cookieFor(legacy.token) } })).status, 200);
  const wrongFarm = await issueLegacy(farms[1]);
  assert.equal((await fetch(meUrl, { headers: { Cookie: cookieFor(wrongFarm.token) } })).status, 401);
  await runAsFarm(farms[0], () => prisma.setting.deleteMany({ where: { key: wrongFarm.key } }));
  assert.equal((await fetch(meUrl, { headers: { Cookie: SESSION_COOKIE + "=%ZZ" } })).status, 401);

  const spare = await runAsFarm(farms[0], () => createSession(owner.id));
  const sessions = async (cookie) => {
    const response = await fetch(authUrl, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("cache-control")?.includes("no-store"));
    return (await response.json()).sessions;
  };
  const listed = await sessions(ownerA);
  assert.equal(listed.length, 3);
  assert.equal(listed.filter(({ current }) => current).length, 1);
  assert.equal(JSON.stringify(listed).includes(spare.token), false);
  const spareSession = (await sessions(cookieFor(spare.token))).find(({ current }) => current);
  const legacySession = (await sessions(cookieFor(legacy.token))).find(({ current }) => current);
  const currentSession = listed.find(({ current }) => current);
  const revoke = (cookie, query, requestOrigin = origin) => fetch(authUrl + query, {
    method: "DELETE", headers: { Cookie: cookie, Origin: requestOrigin },
  });
  const legacySelector = "?id=" + encodeURIComponent(legacySession.id);
  assert.equal((await revoke(ownerA, legacySelector, "https://other.example")).status, 403);
  assert.equal((await revoke(ownerB, legacySelector)).status, 404);
  assert.equal((await revoke(worker, legacySelector)).status, 404);
  assert.equal((await revoke(ownerA, "?id=" + currentSession.id)).status, 404);
  assert.equal((await revoke(ownerA, legacySelector)).status, 200);
  assert.equal((await fetch(meUrl, { headers: { Cookie: cookieFor(legacy.token) } })).status, 401);
  assert.equal((await revoke(ownerA, "?scope=others")).status, 200);
  assert.equal((await fetch(meUrl, { headers: { Cookie: cookieFor(spare.token) } })).status, 401);
  assert.deepEqual((await sessions(ownerA)).map(({ id }) => id), [currentSession.id]);
  assert.equal((await sessions(worker)).length, 1);
  assert.equal((await sessions(ownerB)).length, 1);
  assert.notEqual(spareSession.id, currentSession.id);
  console.log("Session farm binding, legacy compatibility, cross-origin protection, and revocation passed.");

  const customerUrl = origin + "/api/customers";
  const customer = await fetch(customerUrl, {
    method: "POST", headers: { Cookie: ownerA, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Customer A", phone: "private-contact" }),
  });
  assert.equal(customer.status, 201);
  const [customerA, customerB] = await Promise.all([ownerA, ownerB].map(async (cookie) => {
    const response = await fetch(customerUrl, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.deepEqual(customerA.map(({ name }) => name), ["Customer A"]);
  assert.deepEqual(customerB, []);

  const exportFarm = (cookie) => fetch(origin + "/api/export?type=farm", { headers: { Cookie: cookie } });
  assert.equal((await exportFarm(worker)).status, 403);
  const [exportA, exportB] = await Promise.all([ownerA, ownerB].map(async (cookie) => {
    const response = await exportFarm(cookie);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  }));
  assert.equal(exportA.records.customer[0].phone, "private-contact");
  assert.deepEqual(exportB.records.customer, []);
  assert.equal(exportA.records.setting, undefined);

  const { collectOriyaCameraTemperatures, currentClimate, currentFlockCheck } = await import("../lib/oriya.ts");
  const { withProtectedFarmData } = await import("../lib/farm-database.ts");
  for (const [index, farmId] of farms.entries()) {
    await runAsFarm(farmId, () => prisma.batch.create({
      data: { farmId, name: "Isolation flock " + index, status: "ACTIVE", initialChicks: 20 + index, chickCostMinor: 0, startDate: new Date() },
    }));
  }
  const checks = await Promise.all(farms.map((farmId) => runAsFarm(farmId, () => currentFlockCheck("Test house"))));
  assert.deepEqual(checks.map((check) => check.birds.alive), [20, 21]);
  await assert.rejects(runAsFarm(farms[0], () => withProtectedFarmData("oriya", (tx) => tx.customer.findMany())), /permission denied|denied access/i);
  console.log("PostgreSQL RLS isolated customer writes and Oriya summary reads.");

  const { DEFAULT_FARM_ID } = await import("../lib/farm-scope.ts");
  const { ensureFarm } = await import("../lib/operations.ts");
  const env = {
    ORIYA_BLINK_TEMPERATURES: "on", ORIYA_CAMERAS: "ci-pen=CI camera,ci-invalid=Bad sensor",
    BLINK_SIDECAR_TOKEN: "T".repeat(32), BLINK_SIDECAR_URL: "http://127.0.0.1:18987",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const fetchOriginal = globalThis.fetch;
  const observedAt = new Date();
  try {
    Object.assign(process.env, env);
    globalThis.fetch = async (url, options) => {
      assert.equal(url, env.BLINK_SIDECAR_URL + "/blink/temperature-sample");
      assert.equal(options.headers.get("X-Sidecar-Token"), env.BLINK_SIDECAR_TOKEN);
      return Response.json({ observedAt, cameras: [
        { name: "CI camera", temperatureC: 26.4 },
        { name: "Other camera", temperatureC: 28 },
        { name: "Bad sensor", temperatureC: 999 },
      ] });
    };
    assert.equal(await runAsFarm(farms[0], collectOriyaCameraTemperatures), 0);
    await runAsFarm(DEFAULT_FARM_ID, async () => {
      await ensureFarm();
      assert.equal(await collectOriyaCameraTemperatures(), 1);
      assert.equal(await collectOriyaCameraTemperatures(), 0);
      const readings = await currentClimate(observedAt);
      assert.deepEqual(readings.filter(({ sensor }) => sensor.startsWith("Blink camera")).map(
        ({ sensor, temperatureC }) => [sensor, temperatureC],
      ), [["Blink camera ci-pen", 26.4]]);
      process.env.ORIYA_BLINK_TEMPERATURES = "off";
      assert.ok((await currentClimate(observedAt)).every(({ sensor }) => !sensor.startsWith("Blink camera")));
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await runAsFarm(DEFAULT_FARM_ID, () => prisma.thermometerReading.deleteMany({
      where: { sensor: "Blink camera ci-pen", readAt: observedAt },
    }));
  }
  console.log("Blink temperature storage, allowlist, deduplication and Oriya opt-out passed.");

} finally {
  app?.kill();
  for (const farmId of farms) await runAsFarm(farmId, () => prisma.farm.deleteMany({ where: { id: farmId } }));
  await Promise.all([prisma.$disconnect(), restricted.$disconnect(), deviceDb.$disconnect()]);
}
