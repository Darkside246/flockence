import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost");
assert.ok(db.hostname === "localhost" || db.hostname === "127.0.0.1");
assert.match(db.pathname, /^\/[A-Za-z0-9_]+_test$/);

const { prisma } = await import("../lib/prisma.ts");
const { runAsFarm } = await import("../lib/farm-scope.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/auth.ts");

const origin = "http://127.0.0.1:3100";
const fixture = randomUUID().slice(0, 8);
const ids = ["camera-ci-a", "camera-ci-b", "camera-ci-unconfigured"].map((id) => id + "-" + fixture);
const platformId = "owner-ci-" + fixture;
const servers = [];
const visionStorage = await mkdtemp(join(tmpdir(), "flockence-vision-ci-"));
const researchReport = join(visionStorage, "research.json");
await writeFile(researchReport, JSON.stringify({ version: 1, release: "10.5281/zenodo.20672799", createdAt: new Date(),
  archives: [{ archive: "ChickenDet.zip", imageFiles: 1, videoFiles: 0, annotationFiles: 1 },
    { archive: "ChickenAct.zip", imageFiles: 0, videoFiles: 5, annotationFiles: 0 }],
  behavior: { clips: 5, accuracy: 0.8, macroF1: 0.75 },
}));
let app;

async function worker(label, token, source) {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-sidecar-token"] !== token) {
      res.writeHead(401).end("{}");
      return;
    }
    if (req.url === "/blink/settings" && req.method === "GET") {
      res.end(JSON.stringify({ systems: [], cameras: [{ name: label, temperatureC: 26 }] }));
    } else if (req.url === "/blink/settings" && req.method === "POST") {
      req.resume();
      res.end(JSON.stringify({ updated: true, worker: label }));
    } else if (req.url === "/cameras") {
      res.end(JSON.stringify([{ name: label, source }]));
    } else if (req.url === "/cameras/" + encodeURIComponent(label) + "/snapshot?fresh=true") {
      res.setHeader("Content-Type", "image/jpeg");
      res.end(Buffer.from([255, 216, 255, 217]));
    } else if (req.method === "POST" && req.url === "/cameras/" + encodeURIComponent(label) + "/inspection-sample") {
      const frame = Buffer.from([255, 216, 255, 224, 0, 4, 1, 2, 255, 217]).toString("base64");
      res.end(JSON.stringify({ capturedAt: new Date().toISOString(), frames: [frame, frame, frame] }));
    } else if (req.method === "POST" && req.url === "/auth/login") {
      req.resume();
      res.end(JSON.stringify({ connected: false, pending2fa: true }));
    } else {
      res.writeHead(404).end("{}");
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: "http://127.0.0.1:" + server.address().port, token };
}

try {
  const cookies = await Promise.all(ids.map((farmId, index) => runAsFarm(farmId, async () => {
    await prisma.farm.create({ data: { id: farmId, name: farmId } });
    const user = await prisma.user.create({
      data: { ...(index === 0 ? { id: platformId } : {}), farmId, name: "Test farm owner", email: "camera-ci-" + index + "@example.test", role: "OWNER" },
    });
    const { token } = await createSession(user.id);
    return SESSION_COOKIE + "=" + encodeURIComponent(token);
  })));
  const { saveFarmLink } = await import("../lib/oriya-farm-link.ts");
  const { signOriyaBody } = await import("../lib/oriya-link.mjs");
  const secret = "p".repeat(44);
  const penA = await runAsFarm(ids[0], async () => {
    assert.equal(await saveFarmLink({ keyId: "cop_" + "s".repeat(24), secret }), true);
    return prisma.setting.create({ data: { key: "PEN::fixture-owner::test-a", value: JSON.stringify({ name: "Test pen" }) } });
  });
  const penB = await runAsFarm(ids[1], async () => {
    assert.equal(await saveFarmLink({ keyId: "cop_" + "v".repeat(24), secret: "v".repeat(44) }), true);
    return prisma.setting.create({ data: { key: "PEN::fixture-owner::test-b", value: JSON.stringify({ name: "Other farm pen" }) } });
  });
  const a = await worker("Farm A camera", "a".repeat(48), "blink");
  const b = await worker("Farm B camera", "b".repeat(48), "rtsp");
  app = spawn(process.execPath, ["--import", "./tests/support/mock-vision-provider.mjs", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3100"], {
    stdio: "inherit",
    env: { ...process.env, APP_URL: origin, FLOCKENCE_AUTH_CAPTCHA: "on", RECAPTCHA_SITE_KEY: "ci-only-site", RECAPTCHA_SECRET_KEY: "ci-only-secret", FLOCKENCE_PLATFORM_ADMIN_IDS: platformId, ORIYA_URL: "https://oriya.si", CHICKENVERSE_RESEARCH: "on", CHICKENVERSE_RESEARCH_FARM_ID: ids[0],
      CHICKENVERSE_RESEARCH_REPORT: researchReport, VISION_STORAGE_DIR: visionStorage, FLOCKENCE_CAMERA_VISION: "on", FLOCKENCE_LIVE_CAMERA_VISION: "on", OPENAI_API_KEY: "ci-only-unused", FLOCKENCE_CAMERA_WORKERS: JSON.stringify({ [ids[0]]: a, [ids[1]]: b }) },
  });
  let ready = false;
  for (let n = 0; n < 25; n++) {
    const response = await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) { ready = true; break; }
    await sleep(500);
  }
  assert.ok(ready, "Flockence failed to start");
  const accountPost = (path, data, headers) => fetch(origin + "/api/auth/" + path, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
  });
  for (const [path, data] of [
    ["login", { email: "robot@example.test", password: "Disposable-password!4" }],
    ["signup", { name: "Example worker", email: "robot@example.test", password: "Disposable-password!4" }],
    ["forgot-password", { email: "robot@example.test" }],
  ]) {
    const missing = await accountPost(path, data);
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /security check/i);
    assert.equal((await accountPost(path, data, { Origin: "https://cross-origin.example" })).status, 403);
  }
  // Missing challenges consume the network quota but cannot lock the target email.
  for (let index = 0; index < 8; index++) {
    assert.equal((await accountPost("login", { email: "robot@example.test", password: "Disposable-password!4" })).status, 400);
  }
  const oversized = await accountPost("login", { email: "x".repeat(17000), password: "x" });
  assert.equal(oversized.status, 400);
  assert.equal((await fetch(origin + "/reset-password?token=fixture")).headers.get("referrer-policy"), "no-referrer");
  assert.equal((await fetch(origin + "/api/team", {
    method: "POST",
    headers: { Cookie: cookies[0], Origin: "https://cross-origin.example", "Content-Type": "application/json" },
    body: "{}",
  })).status, 403);
  const list = (index, spoofedFarm) => fetch(origin + "/api/cameras/cameras", {
    headers: { Cookie: cookies[index], "X-Flockence-Farm": spoofedFarm },
  });
  const results = await Promise.all([list(0, ids[1]), list(1, ids[0]), list(2, ids[0])]);
  assert.deepEqual(results.map((response) => response.status), [200, 200, 503]);
  assert.deepEqual(await results[0].json(), [{ name: "Farm A camera", source: "blink" }]);
  assert.deepEqual(await results[1].json(), [{ name: "Farm B camera", source: "rtsp" }]);
  assert.equal((await fetch(origin + "/api/cameras/cameras")).status, 401);

  const login = (requestOrigin) => fetch(origin + "/api/cameras/auth/login", {
    method: "POST",
    headers: { Cookie: cookies[0], Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test@example.test", password: "disposable" }),
  });
  assert.equal((await login("https://cross-origin.example")).status, 403);
  const challenge = await login(origin);
  assert.equal(challenge.status, 200);
  assert.equal((await challenge.json()).pending2fa, true);
  const settings = origin + "/api/cameras/blink/settings";
  const state = await fetch(settings, { headers: { Cookie: cookies[0] } });
  assert.deepEqual((await state.json()).cameras, [{ name: "Farm A camera", temperatureC: 26 }]);
  const command = (requestOrigin) => fetch(settings, {
    method: "POST", headers: { Cookie: cookies[0], Origin: requestOrigin, "Content-Type": "application/json", "X-Flockence-Farm": ids[1] },
    body: JSON.stringify({ kind: "motion", name: "Farm A camera", enabled: true }),
  });
  assert.equal((await command("https://other.example")).status, 403);
  const change = await command(origin);
  assert.equal(change.status, 200);
  assert.equal((await change.json()).worker, "Farm A camera");
  const visionList = (index) => fetch(origin + "/api/vision/cameras", {
    headers: { Cookie: cookies[index], "X-Flockence-Farm": ids[1 - index] || ids[0] },
  }).then((response) => response.json());
  assert.deepEqual(await visionList(0), [{ name: "Farm A camera", source: "blink", liveSampling: true }]);
  assert.deepEqual(await visionList(1), [{ name: "Farm B camera", source: "rtsp", liveSampling: true }]);
  assert.deepEqual(await visionList(2), []);
  const inspect = (consent, requestOrigin, camera = "Farm B camera", penId = "") => {
    const form = new FormData();
    form.set("camera", camera);
    if (penId) form.set("penId", penId);
    if (consent) form.set("shareCameraImage", "yes");
    return fetch(origin + "/api/vision", {
      method: "POST", headers: { Cookie: cookies[0], Origin: requestOrigin }, body: form,
    });
  };
  assert.equal((await inspect(false, origin)).status, 400);
  assert.equal((await inspect(true, "https://other.example")).status, 403);
  assert.equal((await inspect(true, origin)).status, 502);
  assert.equal((await inspect(true, origin, "Farm A camera", penB.id)).status, 404);
  const assignCamera = (account, camera, penId, requestOrigin = origin) => fetch(origin + "/api/vision/cameras", {
    method: "PUT", headers: { Cookie: cookies[account], Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ camera, penId }),
  });
  assert.equal((await assignCamera(0, "Farm A camera", penA.id, "https://cross-origin.example")).status, 403);
  assert.equal((await assignCamera(0, "Farm A camera", penB.id)).status, 404);
  assert.equal((await assignCamera(1, "Farm A camera", penB.id)).status, 404);
  const assigned = await assignCamera(0, "Farm A camera", penA.id);
  assert.equal(assigned.status, 200);
  assert.equal((await assigned.json()).pen.id, penA.id);
  const listed = await fetch(origin + "/api/vision/cameras", { headers: { Cookie: cookies[0] } });
  assert.equal((await listed.json())[0].pen.id, penA.id);
  const prefs = (allowVisionImages, extra = {}, account = 0) => fetch(origin + "/api/account/preferences", {
    method: "PUT", headers: { Cookie: cookies[account], Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test farm owner", preferences: { allowVisionImages, farmAlertEmail: true, farmReportEmail: false }, ...extra }),
  });
  assert.equal((await prefs(false, { farmId: ids[1] })).status, 400);
  assert.equal((await prefs(false)).status, 200);
  const declined = await inspect(true, origin, "Farm A camera");
  assert.equal(declined.status, 403);
  assert.match((await declined.json()).error, /disabled image sharing/);
  assert.equal((await prefs(true)).status, 200);
  const inspection = await inspect(true, origin, "Farm A camera");
  assert.equal(inspection.status, 201);
  const saved = await inspection.json();
  assert.equal(saved.analysis.summary, "Inspection test result.");
  assert.equal(saved.observation.visionAssessment.status, "WARNING");
  assert.equal(saved.observation.visionAssessment.evidenceId, saved.observation.visionMediaId);
  assert.match(saved.observation.notes, /Camera: Farm A camera \(blink\)/);
  const media = origin + saved.imageUrl;
  const ownImage = await fetch(media, { headers: { Cookie: cookies[0] } });
  assert.equal(ownImage.status, 200);
  assert.deepEqual([...new Uint8Array(await ownImage.arrayBuffer())], [255, 216, 255, 217]);
  assert.equal((await fetch(media, { headers: { Cookie: cookies[1] } })).status, 404);
  const repeated = await inspect(true, origin, "Farm A camera", penA.id);
  assert.equal(repeated.status, 201);
  const later = await repeated.json();
  const query = new URLSearchParams({ earlier: saved.observation.id, later: later.observation.id });
  const comparisonUrl = origin + "/api/vision/compare?" + query;
  const comparable = await fetch(comparisonUrl, { headers: { Cookie: cookies[0] } });
  assert.equal(comparable.status, 200);
  assert.deepEqual((await comparable.json()).changes.map(({ category }) => category), ["LITTER"]);
  assert.equal((await fetch(comparisonUrl, { headers: { Cookie: cookies[1] } })).status, 404);
  assert.equal((await fetch(comparisonUrl)).status, 401);
  const requestId = "oriya-" + randomUUID();
  const penBody = (farmId, pen) => JSON.stringify({ purpose: "flockence.pen-report.v1", farmId, requestId, pen });
  const signedRequest = (farmId, raw) => {
    const now = Math.floor(Date.now() / 1000);
    return fetch(origin + "/api/integrations/oriya/pen-report", {
      method: "POST", body: raw, headers: {
        "Content-Type": "application/json", "X-Flockence-Farm": farmId, "X-Oriya-Timestamp": String(now),
        "X-Oriya-Signature": signOriyaBody(secret, now, raw),
      },
    });
  };
  const validBody = penBody(ids[0], "Test pen");
  const linked = await signedRequest(ids[0], validBody);
  assert.equal(linked.status, 200);
  const report = await linked.json();
  assert.equal(report.pen.id, penA.id);
  assert.equal(report.inspections.length, 2);
  assert.equal(report.inspections[0].status, "WARNING");
  assert.equal(report.farmContext, null);
  assert.equal((await assignCamera(0, "Farm A camera", null)).status, 200);
  assert.equal("imageUrl" in report.inspections[0], false);
  assert.equal((await signedRequest(ids[0], validBody)).status, 409);
  assert.equal((await signedRequest(ids[1], validBody)).status, 400);
  assert.equal((await signedRequest(ids[1], penBody(ids[1], "Other farm pen"))).status, 401);
  const videoInspect = (camera, consent = true) => {
    const form = new FormData();
    form.set("camera", camera);
    form.set("captureMode", "video-sample");
    if (consent) form.set("shareCameraImage", "yes");
    return fetch(origin + "/api/vision", {
      method: "POST", headers: { Cookie: cookies[1], Origin: origin }, body: form,
    });
  };
  assert.equal((await prefs(true, {}, 1)).status, 200);
  assert.equal((await videoInspect("Farm B camera", false)).status, 400);
  assert.equal((await videoInspect("Farm B camera")).status, 409);
  assert.equal((await videoInspect("Farm A camera")).status, 502);
  assert.equal((await assignCamera(1, "Farm B camera", penB.id)).status, 200);
  const videoResult = await videoInspect("Farm B camera");
  assert.equal(videoResult.status, 201, await videoResult.clone().text());
  const video = await videoResult.json();
  assert.deepEqual(video.observation.visionAssessment.capture, { mode: "VIDEO_SAMPLE", frames: 3 });
  assert.equal(video.observation.visionAssessment.pen.id, penB.id);
  assert.equal((await fetch(origin + video.imageUrl, { headers: { Cookie: cookies[0] } })).status, 404);
  const reportUrl = origin + "/api/vision/research";
  const research = await fetch(reportUrl, { headers: { Cookie: cookies[0] } });
  assert.equal(research.status, 200);
  assert.equal((await research.json()).report.behavior.macroF1, 0.75);
  assert.equal((await fetch(reportUrl, { headers: { Cookie: cookies[1] } })).status, 404);
  assert.equal((await fetch(reportUrl)).status, 401);
  const headerFor = (index) => ({ Cookie: cookies[index], Origin: origin, "Content-Type": "application/json" });
  const platform = origin + "/api/platform/status";
  assert.equal((await fetch(platform, { headers: headerFor(1) })).status, 404);
  assert.equal((await fetch(platform, { headers: headerFor(0) })).status, 200);
  const settingsUrl = origin + "/api/settings";
  const cost = (value) => fetch(settingsUrl, { method: "PUT", headers: headerFor(0), body: JSON.stringify({
    settings: [{ key: "default_chick_cost", value, previous: null }],
  }) });
  assert.equal((await cost("2.95")).status, 200);
  assert.equal((await cost("3.00")).status, 409);

  const flock = await runAsFarm(ids[0], async () => {
    await prisma.setting.create({ data: { key: "MEMBERSHIP_V1", value: "FREE" } });
    return prisma.batch.create({ data: { name: "Offline test flock", startDate: new Date("2020-01-01"),
      initialChicks: 20, chickCostMinor: 0, status: "ACTIVE" } });
  });
  const laying = await runAsFarm(ids[0], () => prisma.batch.create({ data: {
    name: "Test layer flock", startDate: new Date("2020-01-01"), initialChicks: 12, chickCostMinor: 0,
    status: "ACTIVE", productionType: "LAYER", layerStage: "LAYING", species: "CHICKEN",
  } }));
  assert.equal((await list(0, ids[1])).status, 403);
  const saleLot = await runAsFarm(ids[0], async () => {
    const batch = await prisma.batch.create({ data: {
      name: "Sale fixture flock", startDate: new Date("2020-01-01"), initialChicks: 20, chickCostMinor: 0, status: "ACTIVE",
    } });
    const product = await prisma.product.create({ data: { name: "Prepared poultry fixture", unit: "each" } });
    return prisma.inventoryItem.create({ data: { batchId: batch.id, productId: product.id, quantity: 5, sellingPriceMinor: 300 } });
  });
  const workspace = await fetch(origin + "/api/offline/workspace", { headers: headerFor(0) }).then((response) => response.json());
  assert.equal(workspace.flocks[0].id, flock.id);
  assert.ok(workspace.saleLots.some(lot => lot.id === saleLot.id));
  const mortality = { batchId: flock.id, date: workspace.today, quantity: 2, offline: { ...workspace.scope, id: randomUUID() } };
  const submit = (index, data) => fetch(origin + "/api/mortality", {
    method: "POST", headers: headerFor(index), body: JSON.stringify(data),
  });
  assert.equal((await submit(1, mortality)).status, 403);
  const [first, replay] = await Promise.all([submit(0, mortality), submit(0, mortality)]);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal((await first.json()).id, (await replay.json()).id);
  assert.equal((await submit(0, { ...mortality, quantity: 3 })).status, 409);
  assert.equal(await runAsFarm(ids[0], () => prisma.mortalityEvent.count({ where: { batchId: flock.id } })), 1);
  assert.equal(await runAsFarm(ids[0], () => prisma.birdCount.count({ where: { batchId: flock.id } })), 1);

  const weight = { batchId: flock.id, date: workspace.today, quantity: 5, avgWeightKg: 1.3,
    scope: "INDIVIDUAL", offline: { ...workspace.scope, id: randomUUID() } };
  const submitWeight = (index, data) => fetch(origin + "/api/weights", {
    method: "POST", headers: headerFor(index), body: JSON.stringify(data),
  });
  assert.equal((await submitWeight(1, weight)).status, 403);
  const weightReceipts = await Promise.all([submitWeight(0, weight), submitWeight(0, weight)]);
  assert.deepEqual(weightReceipts.map(response => response.status), [201, 201]);
  const [weightA, weightB] = await Promise.all(weightReceipts.map(response => response.json()));
  assert.equal(weightA.id, weightB.id);
  assert.equal((await submitWeight(0, { ...weight, avgWeightKg: 1.6 })).status, 409);
  assert.equal((await submitWeight(0, { ...weight, offline: { ...weight.offline, id: randomUUID() } })).status, 409);

  const eggs = { batchId: laying.id, date: workspace.today, liveHens: 10, totalEggs: 7, saleableEggs: 6,
    dirtyEggs: 1, crackedEggs: 0, floorEggs: 0, rejectedEggs: 0, grades: [{ grade: "UNGRADED", quantity: 6 }],
    offline: { ...workspace.scope, id: randomUUID() },
  };
  const submitEggs = (index, data) => fetch(origin + "/api/egg-collections", {
    method: "POST", headers: headerFor(index), body: JSON.stringify(data),
  });
  assert.equal((await submitEggs(1, eggs)).status, 403);
  const eggReceipts = await Promise.all([submitEggs(0, eggs), submitEggs(0, eggs)]);
  assert.deepEqual(eggReceipts.map(response => response.status), [200, 200]);
  const [eggsA, eggsB] = await Promise.all(eggReceipts.map(response => response.json()));
  assert.equal(eggsA.id, eggsB.id);
  assert.equal((await submitEggs(0, { ...eggs, liveHens: 9 })).status, 409);
  assert.equal((await submitEggs(0, { ...eggs, offline: { ...eggs.offline, id: randomUUID() } })).status, 409);
  const previousDay = new Date(Date.parse(workspace.today) - 86400000).toISOString().slice(0, 10);

  const feed = { batchId: flock.id, date: workspace.today, feedKg: 3.25, offline: { ...workspace.scope, id: randomUUID() } };
  const submitFeed = (index, data) => fetch(origin + "/api/daily-flock-check", {
    method: "POST", headers: headerFor(index), body: JSON.stringify(data),
  });
  assert.equal((await submitFeed(1, feed)).status, 403);
  const feedResponses = await Promise.all([submitFeed(0, feed), submitFeed(0, feed)]);
  assert.deepEqual(feedResponses.map(response => response.status), [201, 201]);
  const [feedA, feedB] = await Promise.all(feedResponses.map(response => response.json()));
  assert.equal(feedA.id, feedB.id);
  assert.equal((await submitFeed(0, { ...feed, feedKg: 3.5 })).status, 409);
  assert.equal((await submitFeed(0, { ...feed, offline: { ...feed.offline, id: randomUUID() } })).status, 409);

  const expense = { date: workspace.today, category: "Supplies", description: "Farm tools", amountMinor: 1250,
    currency: workspace.currency, offline: { ...workspace.scope, id: randomUUID() } };
  const submitExpense = (index, data) => fetch(origin + "/api/expenses", {
    method: "POST", headers: headerFor(index), body: JSON.stringify(data),
  });
  assert.equal((await submitExpense(1, expense)).status, 403);
  assert.equal((await submitExpense(0, { ...expense, currency: "XXX" })).status, 409);
  const expenseReceipts = await Promise.all([submitExpense(0, expense), submitExpense(0, expense)]);
  assert.deepEqual(expenseReceipts.map(response => response.status), [201, 201]);
  const [expenseA, expenseB] = await Promise.all(expenseReceipts.map(response => response.json()));
  assert.equal(expenseA.id, expenseB.id);
  assert.equal((await submitExpense(0, { ...expense, amountMinor: 1300 })).status, 409);
  assert.equal(await runAsFarm(ids[0], () => prisma.expense.count()), 1);

  const inspectionPhoto = Buffer.from([255, 216, 255, 217, 255, 217]).toString("base64");
  const draft = { batchId: flock.id, date: workspace.today, notes: "Observed bedding",
    temperatureC: 24, humidityPercent: 62, beddingIssue: true, ventilationIssue: false,
    waterChange: false, feedChange: false, photo: inspectionPhoto, offline: { ...workspace.scope, id: randomUUID() } };
  const inspectionPath = origin + "/api/offline/inspections";
  const submitInspection = (account, data) => fetch(inspectionPath, {
    method: "POST", headers: headerFor(account), body: JSON.stringify(data),
  });
  assert.equal((await submitInspection(1, draft)).status, 403);
  assert.equal((await submitInspection(0, { ...draft, photo: "aW52YWxpZA==" })).status, 400);
  const receipts = await Promise.all([submitInspection(0, draft), submitInspection(0, draft)]);
  assert.deepEqual(receipts.map(response => response.status), [201, 201]);
  const [inspectionA, inspectionB] = await Promise.all(receipts.map(response => response.json()));
  assert.equal(inspectionA.id, inspectionB.id);
  assert.equal((await submitInspection(0, { ...draft, notes: "Changed" })).status, 409);
  const photoUrl = inspectionPath + "?photo=" + inspectionA.id;
  assert.equal((await fetch(photoUrl)).status, 401);
  assert.equal((await fetch(photoUrl, { headers: headerFor(1) })).status, 404);
  const photoResult = await fetch(photoUrl, { headers: headerFor(0) });
  assert.equal(photoResult.status, 200);
  assert.equal(photoResult.headers.get("content-disposition"), 'attachment; filename="flock-inspection.jpg"');
  assert.equal(Buffer.from(await photoResult.arrayBuffer()).toString("base64"), inspectionPhoto);
  const removePhoto = account => fetch(inspectionPath, {
    method: "DELETE", headers: headerFor(account), body: JSON.stringify({ id: inspectionA.id }),
  });
  assert.equal((await removePhoto(1)).status, 404);
  assert.equal((await removePhoto(0)).status, 200);
  assert.equal((await fetch(photoUrl, { headers: headerFor(0) })).status, 404);
  assert.equal((await submitInspection(0, draft)).status, 201);
  assert.equal((await fetch(photoUrl, { headers: headerFor(0) })).status, 404);

  const saleDraft = { date: workspace.today, currency: workspace.currency, amountPaidMinor: 600, customerName: "",
    items: [{ inventoryItemId: saleLot.id, batchId: saleLot.batchId, quantity: 2, unitPriceMinor: 300 }],
    offline: { ...workspace.scope, id: randomUUID() } };
  const submitDraftSale = (account, data) => fetch(origin + "/api/sales", {
    method: "POST", headers: headerFor(account), body: JSON.stringify(data),
  });
  assert.equal((await submitDraftSale(1, saleDraft)).status, 403);
  assert.equal((await submitDraftSale(0, { ...saleDraft, currency: "XXX" })).status, 409);
  assert.equal((await submitDraftSale(0, { ...saleDraft, items: [{ ...saleDraft.items[0], batchId: laying.id }] })).status, 409);
  const sales = await Promise.all([submitDraftSale(0, saleDraft), submitDraftSale(0, saleDraft)]);
  assert.ok(sales.every(response => response.status === 200 || response.status === 201));
  const [saleA, saleB] = await Promise.all(sales.map(response => response.json()));
  assert.equal(saleA.id, saleB.id);
  assert.equal((await submitDraftSale(0, { ...saleDraft, customerName: "Changed" })).status, 409);
  assert.equal((await submitDraftSale(0, { ...saleDraft, offline: { ...saleDraft.offline, id: randomUUID() },
    items: [{ ...saleDraft.items[0], quantity: 99 }] })).status, 409);
  assert.equal(Number((await runAsFarm(ids[0], () => prisma.inventoryItem.findUnique({ where: { id: saleLot.id } }))).quantity), 3);

  if (process.env.FLOCKENCE_BROWSER_MODULE) {
    const { chromium } = createRequire(import.meta.url)(process.env.FLOCKENCE_BROWSER_MODULE);
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: SESSION_COOKIE, value: cookies[0].slice(SESSION_COOKIE.length + 1), url: origin }]);
      const page = await context.newPage();
      await page.goto(origin + "/offline.html");
      await page.locator("#passphrase").fill("test-device-research-only-123");
      await page.locator("#unlock-button").click();
      await page.locator("#farm").waitFor({ state: "visible" });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await context.setOffline(true);
      await page.selectOption("#flock", flock.id);
      await page.locator("#quantity").fill("1");
      await page.locator("#notes").fill("private offline fixture");
      await page.locator("#save").click();
      await page.getByText("Saved on this device. Waiting to sync.").waitFor();
      await page.selectOption("#record-kind", "weight");
      await page.selectOption("#flock", flock.id);
      await page.locator("#quantity").fill("3");
      await page.locator("#average-weight").fill("1.2");
      await page.locator("#save").click();
      await page.getByText(/Live weight.*Waiting to sync/).waitFor();
      await page.selectOption("#record-kind", "eggs");
      await page.selectOption("#flock", laying.id);
      await page.locator("#date").fill(previousDay);
      await page.locator("#hens").fill("10");
      await page.locator("#saleable-eggs").fill("6");
      await page.locator("#save").click();
      await page.getByText(/Egg collection.*Waiting to sync/).waitFor();
      await page.selectOption("#record-kind", "feed");
      await page.selectOption("#flock", flock.id);
      await page.locator("#date").fill(previousDay);
      await page.locator("#feed-weight").fill("2.5");
      await page.locator("#save").click();
      await page.getByText(/Feed consumption.*Waiting to sync/).waitFor();
      await page.selectOption("#record-kind", "expense");
      await page.locator("#expense-category").fill("Supplies");
      await page.locator("#expense-description").fill("Cleaning brush");
      await page.locator("#expense-amount").fill("4.50");
      await page.locator("#save").click();
      await page.getByText(/Expense.*4.50.*Waiting to sync/).waitFor();
      await page.selectOption("#record-kind", "inspection");
      await page.selectOption("#flock", flock.id);
      await page.locator("#inspection-notes").fill("Offline inspection fixture");
      const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 10;
        canvas.height = 10;
        return canvas.toDataURL("image/png").split(",")[1];
      });
      await page.locator("#inspection-photo").setInputFiles({
        name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(png, "base64"),
      });
      await page.locator("#save").click();
      await page.getByText(/Flock inspection.*Photo attached.*Waiting to sync/).waitFor();
      await page.selectOption("#record-kind", "treatment");
      await page.selectOption("#flock", flock.id);
      await page.locator("#treatment-product").fill("Test treatment fixture");
      await page.locator("#treatment-notes").fill("Observed administration fixture");
      await page.locator("#save").click();
      await page.getByText(/Treatment.*Test treatment fixture.*Waiting to sync/).waitFor();
      await page.selectOption("#record-kind", "sale");
      await page.selectOption("#sale-lot", saleLot.id);
      await page.locator("#sale-quantity").fill("1");
      await page.locator("#sale-paid").fill("3.00");
      await page.locator("#save").click();
      await page.getByText(/Sale draft.*Awaiting online confirmation/).waitFor();
      await page.reload();
      await page.locator("#passphrase").fill("test-device-research-only-123");
      await page.locator("#unlock-button").click();
      await page.getByText(/Mortality.*Waiting to sync/).waitFor();
      await page.getByText(/Live weight.*Waiting to sync/).waitFor();
      await page.getByText(/Egg collection.*Waiting to sync/).waitFor();
      await page.getByText(/Feed consumption.*Waiting to sync/).waitFor();
      await page.getByText(/Expense.*4.50.*Waiting to sync/).waitFor();
      await page.getByText(/Flock inspection.*Photo attached.*Waiting to sync/).waitFor();
      await page.getByText(/Treatment.*Test treatment fixture.*Waiting to sync/).waitFor();
      await context.setOffline(false);
      await page.getByText(/Sale draft.*Awaiting online confirmation/).waitFor();
      await page.getByText(/Treatment.*Test treatment fixture.*Waiting to sync/).waitFor({ state: "hidden" });
      assert.equal(Number((await runAsFarm(ids[0], () => prisma.inventoryItem.findUnique({ where: { id: saleLot.id } }))).quantity), 3);
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Review and confirm sale" }).click();
      await page.getByText("No entries waiting to sync.").waitFor();
      assert.equal(Number((await runAsFarm(ids[0], () => prisma.inventoryItem.findUnique({ where: { id: saleLot.id } }))).quantity), 2);
      assert.equal(await runAsFarm(ids[0], () => prisma.mortalityEvent.count({ where: { batchId: flock.id } })), 2);
      assert.equal(await runAsFarm(ids[0], () => prisma.weightRecord.count({ where: { batchId: flock.id } })), 2);

      assert.equal(await runAsFarm(ids[0], () => prisma.eggCollection.count({ where: { batchId: laying.id } })), 2);

      assert.equal(await runAsFarm(ids[0], () => prisma.dailyFlockCheck.count({ where: { batchId: flock.id } })), 2);

      assert.equal(await runAsFarm(ids[0], () => prisma.expense.count()), 2);

      const syncedTreatment = await runAsFarm(ids[0], () => prisma.treatment.findFirst({ where: { batchId: flock.id, productName: "Test treatment fixture" } }));
      assert.equal(syncedTreatment.status, "ACTIVE");
      assert.equal(syncedTreatment.withdrawalClearsAt, null);
      await page.goto(origin + "/inspections");
      await page.getByText("Offline inspection fixture").waitFor();
      await page.getByRole("link", { name: "Download inspection photo" }).waitFor();

      let blink = "disconnected";
      await page.route("**/api/cameras/status", (route) => route.fulfill({ json: {
        available: true, canManage: true, networkCameras: true,
        connected: blink === "connected", pending2fa: blink === "verification",
      } }));
      await page.route("**/api/cameras/cameras", (route) => route.fulfill({ json: [
        ...(blink === "connected" ? [{ name: "Brooder camera", source: "blink" }] : []),
        { name: "Network barn camera", source: "rtsp" },
      ] }));
      await page.route("**/api/cameras/auth/login", async (route) => {
        const submitted = route.request().postDataJSON();
        assert.equal(submitted.username, "blink-fixture@example.test");
        blink = "verification";
        await route.fulfill({ json: { pending2fa: true } });
      });
      await page.route("**/api/cameras/auth/verify", async (route) => {
        assert.equal(route.request().postDataJSON().pin, "123456");
        blink = "connected";
        await route.fulfill({ json: { connected: true } });
      });
      await page.route("**/api/camera-gateway", (route) => route.fulfill({ json: {
        enabled: true, owner: true, feeds: [
          { id: "wyze-fixture", name: "Wyze hatchery", brand: "wyze", capturedAt: "2026-11-26T10:00:00Z" },
          { id: "network-fixture", name: "Other gateway", brand: "network", capturedAt: null },
        ],
      } }));
      await page.goto(origin + "/settings#cameras");
      await page.setViewportSize({ width: 1280, height: 900 });
      const search = page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Search Flockence", exact: true });
      await search.waitFor({ state: "visible" });
      const before = await search.boundingBox();
      assert.ok(before && before.height <= 36, "Desktop search should be compact");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const after = await search.boundingBox();
      assert.ok(after && Math.abs(before.y - after.y) <= 1, "Desktop search should stay pinned as the page scrolls");
      await search.click();
      const palette = page.getByRole("dialog", { name: "Flockence search" });
      await palette.waitFor({ state: "visible" });
      await palette.getByRole("textbox", { name: "Search Flockence" }).fill("cameras");
      await palette.getByRole("link", { name: /Cameras/i }).waitFor();
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileSearch = page.getByRole("button", { name: "Search Flockence", exact: true });
      await mobileSearch.click();
      await palette.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 1280, height: 900 });
      const provider = page.getByLabel("Camera provider");
      await provider.selectOption("blink");
      await page.getByLabel("Blink email").fill("blink-fixture@example.test");
      await page.getByLabel("Blink password").fill("disposable-camera-password");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.getByLabel("Verification code from Blink").fill("123456");
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await page.getByRole("link", { name: "Brooder camera", exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Network barn camera", exact: true }).count(), 0);
      await provider.selectOption("wyze");
      assert.equal(await page.getByRole("link", { name: "Open Wyze live view" }).getAttribute("href"), "https://my.wyze.com/live");
      await page.getByRole("heading", { name: "Wyze account" }).waitFor();
      await page.getByRole("heading", { name: "Wyze hatchery" }).waitFor();
      assert.equal(await page.getByLabel("Blink password").count(), 0);
      assert.equal(await page.getByRole("heading", { name: "Other gateway" }).count(), 0);
      await provider.selectOption("network");
      await page.getByRole("link", { name: "Network barn camera", exact: true }).waitFor();
      await page.getByRole("heading", { name: "Other gateway" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Wyze hatchery" }).count(), 0);
    } finally {
      await browser.close();
    }
  }

  const pendingTreatment = { batchId: laying.id, productName: "Offline test record", startedAt: previousDay,
    endedAt: null, clearsOn: null, notes: "", offline: { ...workspace.scope, id: randomUUID() } };
  const submitTreatment = (account, data) => fetch(origin + "/api/health/treatments", {
    method: "POST", headers: headerFor(account), body: JSON.stringify(data),
  });
  assert.equal((await submitTreatment(1, pendingTreatment)).status, 403);
  assert.equal((await submitTreatment(0, { ...pendingTreatment, clearsOn: workspace.today })).status, 400);
  const treatmentResponses = await Promise.all([submitTreatment(0, pendingTreatment), submitTreatment(0, pendingTreatment)]);
  assert.deepEqual(treatmentResponses.map(response => response.status), [201, 201]);
  const [treatmentA, treatmentB] = await Promise.all(treatmentResponses.map(response => response.json()));
  assert.equal(treatmentA.id, treatmentB.id);
  assert.equal((await submitTreatment(0, { ...pendingTreatment, notes: "Different note" })).status, 409);
  assert.equal(await runAsFarm(ids[0], () => prisma.treatment.count({ where: { batchId: laying.id } })), 1);
  const blockedSale = await fetch(origin + "/api/sales", {
    method: "POST", headers: headerFor(0), body: JSON.stringify({ date: workspace.today,
      items: [{ batchId: laying.id, quantity: 1, unitPriceMinor: 100, description: "Egg" }] }),
  });
  assert.equal(blockedSale.status, 409);
  assert.match((await blockedSale.json()).error, /withdrawal/i);
  const heldLot = await runAsFarm(ids[0], async () => {
    const product = await prisma.product.create({ data: { name: "Held lot fixture", unit: "each" } });
    return prisma.inventoryItem.create({ data: { batchId: laying.id, productId: product.id, quantity: 3 } });
  });
  const held = await submitDraftSale(0, { ...saleDraft, offline: { ...saleDraft.offline, id: randomUUID() },
    items: [{ ...saleDraft.items[0], inventoryItemId: heldLot.id, batchId: heldLot.batchId }] });
  assert.equal(held.status, 409);
  assert.match((await held.json()).error, /withdrawal/i);
  console.log("Camera HTTP checks, offline records and withdrawal holds passed.");
} finally {
  app?.kill();
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  for (const farmId of ids) {
    await runAsFarm(farmId, async () => {
      await prisma.inventoryItem.deleteMany({ where: { product: { farmId } } });
      await prisma.farm.deleteMany({ where: { id: farmId } });
    });
  }
  await prisma.$disconnect();
  await rm(visionStorage, { recursive: true, force: true });
}
