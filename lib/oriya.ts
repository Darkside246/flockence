import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { blinkConfigured, blinkFetch } from "@/lib/blink-sidecar";
import {
  MAX_AGE_SECONDS, allowedCameras, buildFlockCheck, deathCause, frameFromBytes, oriyaLinkConfig, signOriyaBody,
  type OriyaFrame, type OriyaLinkConfig, type DeathCause,
} from "@/lib/oriya-link.mjs";

/**
 * Flockence's side of "Oriya is the brain" (docs/ORIYA_LINK.md). Flockence collects the farm numbers and Blink
 * pictures and sends them to Oriya signed; Oriya answers with structured findings and alerts, which are kept here
 * as health observations so people see them in Flockence. Nothing here exposes a camera address, a Blink token, a
 * customer or a staff member to Oriya.
 */

const SEEN_PREFIX = "ORIYA_SEEN::";

/** Accepts each Oriya request id once (kept in Settings, so it survives restarts); old marks are cleared. */
export async function claimOriyaRequestId(requestId: string): Promise<boolean> {
  await ensureFarm();
  const cutoff = new Date(Date.now() - 2 * MAX_AGE_SECONDS * 1000);
  await prisma.setting.deleteMany({ where: { farmId: FARM_ID, key: { startsWith: SEEN_PREFIX }, updatedAt: { lt: cutoff } } });
  try {
    await prisma.setting.create({ data: { farmId: FARM_ID, key: `${SEEN_PREFIX}${requestId}`, value: "1" } });
    return true;
  } catch {
    return false;
  }
}

export type FramesResult =
  | { ok: true; frames: OriyaFrame[]; occurredAt: string }
  | { ok: false; reason: "CAMERA_NOT_ALLOWED" | "CAMERAS_NOT_SET_UP" | "CAMERA_FAILED" | "NO_USABLE_FRAME" };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pictures from one allowed camera through the Blink sidecar. "fresh" asks the camera for new pictures a few seconds
 * apart (wakes it and uses battery); otherwise Blink's latest thumbnail. Each picture is checked by its real bytes.
 */
export async function framesFromCamera(code: string, count: number, secondsApart: number, fresh: boolean): Promise<FramesResult> {
  const name = allowedCameras(process.env).get(code);
  if (!name) return { ok: false, reason: "CAMERA_NOT_ALLOWED" };
  if (!blinkConfigured()) return { ok: false, reason: "CAMERAS_NOT_SET_UP" };
  const occurredAt = new Date().toISOString();
  const frames: OriyaFrame[] = [];
  const total = fresh ? Math.min(Math.max(count, 1), 3) : 1;
  for (let i = 0; i < total; i += 1) {
    if (i > 0) await wait(secondsApart * 1000);
    try {
      const response = await blinkFetch(`/cameras/${encodeURIComponent(name)}/snapshot${fresh ? "?fresh=true" : ""}`, {}, 30_000);
      if (!response.ok) return frames.length ? { ok: true, frames, occurredAt } : { ok: false, reason: "CAMERA_FAILED" };
      const frame = frameFromBytes(Buffer.from(await response.arrayBuffer()), i * secondsApart);
      if (frame) frames.push(frame);
    } catch {
      return frames.length ? { ok: true, frames, occurredAt } : { ok: false, reason: "CAMERA_FAILED" };
    }
  }
  return frames.length ? { ok: true, frames, occurredAt } : { ok: false, reason: "NO_USABLE_FRAME" };
}

/** Sends one signed JSON body to Oriya. No redirects, 45 s limit, answer read up to 200 KB. */
export async function postToOriya(config: OriyaLinkConfig, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(new URL(path, config.baseUrl), {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(45_000),
    headers: { "Content-Type": "application/json", "X-Oriya-Key": config.keyId, "X-Oriya-Timestamp": String(timestamp), "X-Oriya-Signature": signOriyaBody(config.secret, timestamp, raw) },
    body: raw,
  });
  const text = (await response.text()).slice(0, 200_000);
  try { return { status: response.status, json: JSON.parse(text) }; } catch { return { status: response.status, json: null }; }
}

/** Today's farm numbers for Oriya: deaths in the last 24 hours (with causes), feed on hand and used, live birds. */
export async function currentFlockCheck(house: string) {
  await ensureFarm();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const batches = await prisma.batch.findMany({
    where: { farmId: FARM_ID, status: "ACTIVE" },
    select: { id: true, initialChicks: true, startDate: true, birdCounts: { orderBy: { date: "desc" }, take: 1, select: { liveCount: true } }, mortalityEvents: { select: { quantity: true, date: true, reason: true } } },
  });
  const batchIds = batches.map((b) => b.id);
  const [purchases, used, used24, healthCases] = await Promise.all([
    prisma.feedPurchase.findMany({ where: { OR: [{ farmId: FARM_ID }, { batchId: { in: batchIds } }] }, select: { bagSizeKg: true, quantityBags: true } }),
    prisma.feedUsage.aggregate({ where: { batchId: { in: batchIds } }, _sum: { quantityKg: true } }),
    prisma.feedUsage.aggregate({ where: { batchId: { in: batchIds }, date: { gte: since } }, _sum: { quantityKg: true } }),
    prisma.healthCase.count({ where: { farmId: FARM_ID, status: { in: ["OPEN", "MONITORING"] } } }),
  ]);
  const causes: Partial<Record<DeathCause, number>> = {};
  let deaths = 0;
  let alive = 0;
  let oldestDays: number | undefined;
  for (const batch of batches) {
    const dead = batch.mortalityEvents.reduce((sum, m) => sum + m.quantity, 0);
    alive += batch.birdCounts[0]?.liveCount ?? Math.max(0, batch.initialChicks - dead);
    for (const m of batch.mortalityEvents) {
      if (m.date < since) continue;
      deaths += m.quantity;
      const cause = deathCause(m.reason);
      causes[cause] = (causes[cause] ?? 0) + m.quantity;
    }
    const days = Math.floor((now.getTime() - batch.startDate.getTime()) / 86_400_000);
    oldestDays = Math.max(oldestDays ?? 0, days);
  }
  const bought = purchases.reduce((sum, p) => sum + Number(p.bagSizeKg) * Number(p.quantityBags), 0);
  const stock = Math.max(0, bought - Number(used._sum.quantityKg ?? 0));
  return buildFlockCheck({
    eventId: `chk-${now.toISOString().slice(0, 16).replace(/[^0-9]/g, "")}-${house.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "farm"}`,
    occurredAt: now.toISOString(), house, deathsSince: since.toISOString(), deaths, causes,
    feedStockKg: purchases.length ? stock : undefined, feedUsedKg24h: Number(used24._sum.quantityKg ?? 0),
    alive: batches.length ? alive : undefined, ageDays: oldestDays, openHealthCases: healthCases,
  });
}

type OriyaAnswer = { accepted?: boolean; alertDetails?: Array<{ kind: string; urgent: boolean; text: string }>; findings?: { peopleVisible?: boolean } };

/** Keeps Oriya's alerts as health observations, so they show in Flockence's health pages. Text is Oriya's fixed wording. */
async function keepAlerts(answer: OriyaAnswer, source: string) {
  const alerts = Array.isArray(answer.alertDetails) ? answer.alertDetails.slice(0, 20) : [];
  for (const alert of alerts) {
    if (typeof alert?.kind !== "string" || !/^[A-Z_]{3,40}$/.test(alert.kind) || typeof alert.text !== "string") continue;
    await prisma.healthObservation.create({
      data: {
        farmId: FARM_ID, observedAt: new Date(), category: `ORIYA:${alert.kind}`, symptom: alert.text.slice(0, 300),
        severity: alert.urgent ? "URGENT" : "MODERATE", affectedCount: 1, notes: `From Oriya (${source}).`,
      },
    });
  }
  return alerts.length;
}

/** Who refused, in a fixed word: Oriya's own reason code, or NOT_ORIYA when the answer was not Oriya's JSON (a Cloudflare block page, for example). */
function refusalReason(reply: { status: number; json: unknown }): string {
  if (reply.status === 201) return "ACCEPTED";
  const reason = (reply.json as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && /^[A-Z_]{3,40}$/.test(reason) ? reason : "NOT_ORIYA";
}

export interface PushOutcome { check: { status: number; alerts: number; reason: string } | null; snapshots: Array<{ camera: string; status: number | string; alerts: number }> }

/**
 * One scheduled run: send today's numbers, then (optionally) pictures from each allowed camera. "fresh" pictures
 * wake the cameras and use battery; run them every 30-60 minutes, thumbnails in between.
 */
export async function pushToOriya(options: { house: string; pictures: "none" | "thumbnail" | "fresh" }): Promise<PushOutcome | { error: "LINK_NOT_SET_UP" }> {
  const config = oriyaLinkConfig(process.env);
  if (!config) return { error: "LINK_NOT_SET_UP" };
  const outcome: PushOutcome = { check: null, snapshots: [] };
  const check = await currentFlockCheck(options.house);
  const sent = await postToOriya(config, "/api/public/farm/chicken-op/flock-checks", check);
  outcome.check = { status: sent.status, alerts: sent.status === 201 ? await keepAlerts(sent.json as OriyaAnswer, "farm numbers") : 0, reason: refusalReason(sent) };
  if (options.pictures === "none") return outcome;
  for (const code of allowedCameras(process.env).keys()) {
    const fresh = options.pictures === "fresh";
    const frames = await framesFromCamera(code, fresh ? 3 : 1, 3, fresh);
    if (!frames.ok) { outcome.snapshots.push({ camera: code, status: frames.reason, alerts: 0 }); continue; }
    const snapshot = {
      eventId: `snap-${Date.now()}-${code.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "cam"}`, type: "FLOCK_SNAPSHOT", occurredAt: frames.occurredAt,
      house: options.house, camera: code, source: "BLINK", kind: fresh ? "LIVE_VIEW" : "THUMBNAIL", frames: frames.frames,
    };
    const reply = await postToOriya(config, "/api/public/farm/chicken-op/flock-snapshots", snapshot);
    outcome.snapshots.push({ camera: code, status: reply.status, alerts: reply.status === 201 ? await keepAlerts(reply.json as OriyaAnswer, `camera ${code}`) : 0 });
  }
  return outcome;
}
