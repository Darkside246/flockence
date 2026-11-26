import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
const ids = ["camera-ci-a", "camera-ci-b", "camera-ci-unconfigured"];
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
      data: { farmId, name: "Test farm owner", email: "camera-ci-" + index + "@example.test", role: "OWNER" },
    });
    const { token } = await createSession(user.id);
    return SESSION_COOKIE + "=" + encodeURIComponent(token);
  })));
  const a = await worker("Farm A camera", "a".repeat(48), "blink");
  const b = await worker("Farm B camera", "b".repeat(48), "rtsp");
  app = spawn(process.execPath, ["--import", "./tests/support/mock-vision-provider.mjs", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3100"], {
    stdio: "inherit",
    env: { ...process.env, APP_URL: origin, CHICKENVERSE_RESEARCH: "on", CHICKENVERSE_RESEARCH_FARM_ID: ids[0],
      CHICKENVERSE_RESEARCH_REPORT: researchReport, VISION_STORAGE_DIR: visionStorage, FLOCKENCE_CAMERA_VISION: "on", OPENAI_API_KEY: "ci-only-unused", FLOCKENCE_CAMERA_WORKERS: JSON.stringify({ [ids[0]]: a, [ids[1]]: b }) },
  });
  let ready = false;
  for (let n = 0; n < 25; n++) {
    const response = await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) { ready = true; break; }
    await sleep(500);
  }
  assert.ok(ready, "Flockence failed to start");
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
  const inspect = (consent, requestOrigin, camera = "Farm B camera") => {
    const form = new FormData();
    form.set("camera", camera);
    if (consent) form.set("shareCameraImage", "yes");
    return fetch(origin + "/api/vision", {
      method: "POST", headers: { Cookie: cookies[0], Origin: requestOrigin }, body: form,
    });
  };
  assert.equal((await inspect(false, origin)).status, 400);
  assert.equal((await inspect(true, "https://other.example")).status, 403);
  assert.equal((await inspect(true, origin)).status, 502);
  const inspection = await inspect(true, origin, "Farm A camera");
  assert.equal(inspection.status, 201);
  const saved = await inspection.json();
  assert.equal(saved.analysis.summary, "Inspection test result.");
  assert.match(saved.observation.notes, /Camera: Farm A camera \(blink\)/);
  const media = origin + saved.imageUrl;
  const ownImage = await fetch(media, { headers: { Cookie: cookies[0] } });
  assert.equal(ownImage.status, 200);
  assert.deepEqual([...new Uint8Array(await ownImage.arrayBuffer())], [255, 216, 255, 217]);
  assert.equal((await fetch(media, { headers: { Cookie: cookies[1] } })).status, 404);
  const reportUrl = origin + "/api/vision/research";
  const research = await fetch(reportUrl, { headers: { Cookie: cookies[0] } });
  assert.equal(research.status, 200);
  assert.equal((await research.json()).report.behavior.macroF1, 0.75);
  assert.equal((await fetch(reportUrl, { headers: { Cookie: cookies[1] } })).status, 404);
  assert.equal((await fetch(reportUrl)).status, 401);
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
