import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { blinkConfigured, blinkFetch } from "@/lib/blink-sidecar";
import {
  MAX_AGE_SECONDS, allowedCameras, buildFlockCheck, deathCause, frameFromBytes, oriyaLinkConfig, signOriyaBody,
  type OriyaFrame, type OriyaLinkConfig, type DeathCause,
} from "@/lib/oriya-link.mjs";
import {
  DEFAULT_DAILY_LIVE_VIEWS, SEND_WITHIN_MINUTES, autoDecision, climateForOriya, farmHour, farmOffset, isoWithOffset, referenceMinutes,
  type OriyaClimateEntry, type ThermometerReadingInput,
} from "@/lib/climate.mjs";
import { loadReferenceFrame, saveReferenceFrame } from "@/lib/frame-store";
import { pollSwitchbot } from "@/lib/thermometers";

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
  const occurredAt = isoWithOffset(new Date(), farmOffset(process.env));
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

/**
 * Each thermometer's latest reading (within the last 3 hours) and the one about an hour before it, for Oriya's
 * `climate`. Imported history older than that is not sent.
 */
export async function currentClimate(now = new Date()): Promise<OriyaClimateEntry[]> {
  await ensureFarm();
  const rows = await prisma.thermometerReading.findMany({
    where: { farmId: FARM_ID, readAt: { gte: new Date(now.getTime() - (SEND_WITHIN_MINUTES + 100) * 60_000), lte: new Date(now.getTime() + 5 * 60_000) } },
    orderBy: { readAt: "desc" }, take: 5000, select: { sensor: true, readAt: true, temperatureC: true, humidityPercent: true },
  });
  const bySensor = new Map<string, ThermometerReadingInput[]>();
  for (const row of rows) {
    const list = bySensor.get(row.sensor) ?? [];
    list.push({ readAt: row.readAt, temperatureC: Number(row.temperatureC), humidityPct: row.humidityPercent === null ? null : Number(row.humidityPercent) });
    bySensor.set(row.sensor, list);
  }
  return climateForOriya(bySensor, now, farmOffset(process.env));
}

/**
 * For a Live View: the camera's previous Live View picture (5 to 120 minutes old) as Oriya's earlier picture, then
 * this check's last picture is kept for next time. Thumbnails are never used or kept (they can be hours old).
 */
export async function referenceFor(camera: string, frames: OriyaFrame[], now = new Date()) {
  const saved = await loadReferenceFrame(camera);
  const minutes = saved ? referenceMinutes(saved.savedAt, now) : null;
  const last = frames[frames.length - 1];
  if (last) await saveReferenceFrame(camera, last, now);
  return saved && minutes !== null ? { mimeType: saved.frame.mimeType, imageBase64: saved.frame.imageBase64, minutesBefore: minutes } : null;
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
  const offset = farmOffset(process.env);
  const check = buildFlockCheck({
    eventId: `chk-${now.toISOString().slice(0, 16).replace(/[^0-9]/g, "")}-${house.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "farm"}`,
    occurredAt: isoWithOffset(now, offset), house, deathsSince: isoWithOffset(since, offset), deaths, causes,
    feedStockKg: purchases.length ? stock : undefined, feedUsedKg24h: Number(used24._sum.quantityKg ?? 0),
    alive: batches.length ? alive : undefined, ageDays: oldestDays, openHealthCases: healthCases,
  });
  const climate = await currentClimate(now);
  if (climate.length) check.climate = climate;
  return check;
}

type OriyaAnswer = { accepted?: boolean; alertDetails?: Array<{ kind: string; urgent: boolean; text: string }>; findings?: { peopleVisible?: boolean }; nextCheckMinutes?: unknown };

// Schedule state, kept in Settings so it survives restarts.
const LAST_NUMBERS = "ORIYA_LAST_NUMBERS_AT";
const LAST_LIVE_VIEW = "ORIYA_LAST_LIVE_VIEW_AT";
const NEXT_CHECK = "ORIYA_NEXT_CHECK_AT";
const liveViewsKey = (now: Date) => `ORIYA_LIVE_VIEWS::${isoWithOffset(now, farmOffset(process.env)).slice(0, 10)}`;

async function getSetting(key: string): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { farmId_key: { farmId: FARM_ID, key } }, select: { value: true } }))?.value ?? null;
}
async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { farmId_key: { farmId: FARM_ID, key } }, create: { farmId: FARM_ID, key, value }, update: { value } });
}
const minutesSince = (value: string | null, now: Date) => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now.getTime() - at) / 60_000)) : null;
};

/** Oriya's "look again in N minutes" (10 to 60), kept as the time it is due; a sooner one replaces a later one. */
async function rememberNextCheck(answers: OriyaAnswer[], now: Date) {
  const minutes = answers.map((a) => a?.nextCheckMinutes).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 10 && n <= 60);
  if (!minutes.length) return;
  const due = new Date(now.getTime() + Math.min(...minutes) * 60_000);
  const current = Date.parse((await getSetting(NEXT_CHECK)) ?? "");
  if (!Number.isFinite(current) || current <= now.getTime() || due.getTime() < current) await setSetting(NEXT_CHECK, due.toISOString());
}

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

export interface PushOutcome {
  check: { status: number; alerts: number; reason: string } | null;
  snapshots: Array<{ camera: string; status: number | string; alerts: number; comparedWithEarlier?: boolean }>;
  skipped?: "NOT_DUE" | "ALREADY_RUNNING";
  liveViewsToday?: number;
  nextCheckMinutes?: number | null;
}

let running = false;

/**
 * One scheduled run: send today's numbers, then (optionally) pictures from each allowed camera. "fresh" pictures
 * wake the cameras and use battery; run them every 30-60 minutes, thumbnails in between.
 */
export async function pushToOriya(options: { house: string; pictures: "none" | "thumbnail" | "fresh" | "auto" }): Promise<PushOutcome | { error: "LINK_NOT_SET_UP" }> {
  const config = oriyaLinkConfig(process.env);
  if (!config) return { error: "LINK_NOT_SET_UP" };
  if (running) return { check: null, snapshots: [], skipped: "ALREADY_RUNNING" };
  running = true;
  try {
    await ensureFarm();
    const now = new Date();
    let pictures = options.pictures;
    const todayKey = liveViewsKey(now);
    let liveViewsToday = Number((await getSetting(todayKey)) ?? 0) || 0;
    if (pictures === "auto") {
      // The automatic schedule (scripts/oriya-watch.mjs, or cron every minute with "auto").
      const nextCheck = Date.parse((await getSetting(NEXT_CHECK)) ?? "");
      const decision = autoDecision({
        hour: farmHour(now, farmOffset(process.env)),
        minutesSinceNumbers: minutesSince(await getSetting(LAST_NUMBERS), now),
        minutesSinceLiveView: minutesSince(await getSetting(LAST_LIVE_VIEW), now),
        oriyaDueNow: Number.isFinite(nextCheck) && nextCheck <= now.getTime(),
        liveViewsToday,
        dailyCap: Number(process.env.ORIYA_DAILY_LIVE_VIEWS ?? DEFAULT_DAILY_LIVE_VIEWS) || DEFAULT_DAILY_LIVE_VIEWS,
      });
      if (!decision.numbers) return { check: null, snapshots: [], skipped: "NOT_DUE", liveViewsToday };
      pictures = decision.pictures;
    }
    const outcome: PushOutcome = { check: null, snapshots: [] };
    const answers: OriyaAnswer[] = [];
    // Fresh SwitchBot readings first (at most every 5 minutes), so the check carries the current temperatures.
    await pollSwitchbot(now).catch(() => undefined);
    const check = await currentFlockCheck(options.house);
    const sent = await postToOriya(config, "/api/public/farm/chicken-op/flock-checks", check);
    outcome.check = { status: sent.status, alerts: sent.status === 201 ? await keepAlerts(sent.json as OriyaAnswer, "farm numbers") : 0, reason: refusalReason(sent) };
    if (sent.status === 201) { answers.push(sent.json as OriyaAnswer); await setSetting(LAST_NUMBERS, now.toISOString()); }
    if (pictures !== "none") {
      const fresh = pictures === "fresh";
      const climate = Array.isArray(check.climate) ? check.climate : [];
      for (const code of allowedCameras(process.env).keys()) {
        const frames = await framesFromCamera(code, fresh ? 3 : 1, 3, fresh);
        if (!frames.ok) { outcome.snapshots.push({ camera: code, status: frames.reason, alerts: 0 }); continue; }
        const reference = fresh ? await referenceFor(code, frames.frames, now) : null;
        const snapshot = {
          eventId: `snap-${Date.now()}-${code.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "cam"}`, type: "FLOCK_SNAPSHOT", occurredAt: frames.occurredAt,
          house: options.house, camera: code, source: "BLINK", kind: fresh ? "LIVE_VIEW" : "THUMBNAIL", frames: frames.frames,
          ...(reference ? { reference } : {}), ...(climate.length ? { climate } : {}),
        };
        const reply = await postToOriya(config, "/api/public/farm/chicken-op/flock-snapshots", snapshot);
        if (reply.status === 201) answers.push(reply.json as OriyaAnswer);
        outcome.snapshots.push({ camera: code, status: reply.status, alerts: reply.status === 201 ? await keepAlerts(reply.json as OriyaAnswer, `camera ${code}`) : 0, comparedWithEarlier: Boolean(reference) });
      }
      if (fresh) {
        liveViewsToday += 1;
        await setSetting(todayKey, String(liveViewsToday));
        await setSetting(LAST_LIVE_VIEW, now.toISOString());
        // A Live View answers any "look again" that was due.
        await prisma.setting.deleteMany({ where: { farmId: FARM_ID, key: NEXT_CHECK, value: { lte: now.toISOString() } } });
      }
    }
    await rememberNextCheck(answers, now);
    const nextAt = Date.parse((await getSetting(NEXT_CHECK)) ?? "");
    outcome.nextCheckMinutes = Number.isFinite(nextAt) && nextAt > now.getTime() ? Math.ceil((nextAt - now.getTime()) / 60_000) : null;
    outcome.liveViewsToday = liveViewsToday;
    return outcome;
  } finally {
    running = false;
  }
}
