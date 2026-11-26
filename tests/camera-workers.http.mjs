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
      CHICKENVERSE_RESEARCH_REPORT: researchReport, VISION_STORAGE_DIR: visionStorage, FLOCKENCE_CAMERA_VISION: "on", OPENAI_API_KEY: "ci-only-unused", FLOCKENCE_CAMERA_WORKERS: JSON.stringify({ [ids[0]]: a, [ids[1]]: b }) },
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
  assert.deepEqual(await visionList(0), [{ name: "Farm A camera", source: "blink" }]);
  assert.deepEqual(await visionList(1), [{ name: "Farm B camera", source: "rtsp" }]);
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
  const inspection = await inspect(true, origin, "Farm A camera", penA.id);
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
  assert.equal("imageUrl" in report.inspections[0], false);
  assert.equal((await signedRequest(ids[0], validBody)).status, 409);
  assert.equal((await signedRequest(ids[1], validBody)).status, 400);
  assert.equal((await signedRequest(ids[1], penBody(ids[1], "Other farm pen"))).status, 401);
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
  assert.equal((await list(0, ids[1])).status, 403);
  const workspace = await fetch(origin + "/api/offline/workspace", { headers: headerFor(0) }).then((response) => response.json());
  assert.equal(workspace.flocks[0].id, flock.id);
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
      await page.reload();
      await page.locator("#passphrase").fill("test-device-research-only-123");
      await page.locator("#unlock-button").click();
      await page.getByText(/Offline test flock.*Waiting to sync/).waitFor();
      await context.setOffline(false);
      await page.getByText("No entries waiting to sync.").waitFor();
      assert.equal(await runAsFarm(ids[0], () => prisma.mortalityEvent.count({ where: { batchId: flock.id } })), 2);

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
      assert.equal(await page.getByRole("link", { name: "Open Wyze sign-in" }).getAttribute("href"), "https://my.wyze.com/live");
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

  console.log("Camera HTTP checks passed for two private workers and an unconfigured farm.");
} finally {
  app?.kill();
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  for (const farmId of ids) await runAsFarm(farmId, () => prisma.farm.deleteMany({ where: { id: farmId } }));
  await prisma.$disconnect();
  await rm(visionStorage, { recursive: true, force: true });
}
