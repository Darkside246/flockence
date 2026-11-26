import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const adminUrl = new URL(process.env.DATABASE_URL);
const gatewayUrl = new URL(process.env.CAMERA_GATEWAY_DATABASE_URL);
assert.match(adminUrl.pathname, /^\/[A-Za-z0-9_]+_test$/);
assert.equal(adminUrl.hostname, "localhost");
assert.equal(gatewayUrl.host + gatewayUrl.pathname, adminUrl.host + adminUrl.pathname);
assert.equal(gatewayUrl.username, "flockence_camera_gateway");

const { prisma } = await import("../lib/prisma.ts");
const { runAsFarm } = await import("../lib/farm-scope.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/auth.ts");
const restricted = new PrismaClient({ datasourceUrl: gatewayUrl.toString() });
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
  console.log("Gateway isolation, encrypted snapshots, owner permissions and revocation passed.");
} finally {
  app?.kill();
  for (const farmId of farms) await runAsFarm(farmId, () => prisma.farm.deleteMany({ where: { id: farmId } }));
  await Promise.all([prisma.$disconnect(), restricted.$disconnect()]);
}
