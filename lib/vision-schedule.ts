import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { currentFarmId, runAsFarm, runUnscoped } from "@/lib/farm-scope";
import { accountPreferences } from "@/lib/account-preferences";
import { assignedCameraPen } from "@/lib/vision-camera-pens";
import { visionCameras, visionCamerasEnabled, visionLiveEnabled } from "@/lib/vision-camera";
import { AUTOMATIC_MEDIA_PREFIX, runVisionInspection, visionStorageDir } from "@/lib/vision-inspection";
import { shareInspectionWithOriya } from "@/lib/vision-oriya";
import { calendarDateInTimeZone, FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";
import {
  LEASE_MS, SCHEDULE_KEY, STATE_KEY, camerasToRun, clockInZone, inQuietHours, readSchedule, readState, recordAttempt,
  type Schedule, type ScheduleState,
} from "@/lib/vision-schedule-rules.mjs";

/**
 * Automatic camera vision (owner request, 2026-11-27). A systemd timer on the VPS calls the internal route every few
 * minutes; each call runs one round:
 *   for every farm that switched it on -> hold the farm (one round at a time) -> skip quiet hours -> inspect the cameras
 *   that are due (most overdue first, within the daily limit) -> remember each result -> delete automatic pictures
 *   older than the farm's keep-days.
 * A round reuses the same inspection as the "Check my flock" button, with the same pen-assignment checks.
 */

type StoredSchedule = Schedule & { updatedBy?: string; updatedAt?: string };

export async function loadSchedule(): Promise<{ schedule: Schedule | null; updatedBy: string | null; state: ScheduleState }> {
  const rows = await prisma.setting.findMany({ where: { farmId: currentFarmId(), key: { in: [SCHEDULE_KEY, STATE_KEY] } } });
  const raw = rows.find((r) => r.key === SCHEDULE_KEY)?.value;
  let updatedBy: string | null = null;
  try { const v = JSON.parse(raw ?? "null") as StoredSchedule | null; updatedBy = typeof v?.updatedBy === "string" ? v.updatedBy : null; } catch { /* unreadable */ }
  return { schedule: readSchedule(raw), updatedBy, state: readState(rows.find((r) => r.key === STATE_KEY)?.value) };
}

export async function saveSchedule(schedule: Schedule, userId: string) {
  const farmId = currentFarmId();
  const value = JSON.stringify({ ...schedule, updatedBy: userId, updatedAt: new Date().toISOString() } satisfies StoredSchedule);
  await prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: SCHEDULE_KEY } }, select: { value: true } });
    await tx.setting.upsert({ where: { farmId_key: { farmId, key: SCHEDULE_KEY } }, create: { farmId, key: SCHEDULE_KEY, value }, update: { value } });
    await tx.auditLog.create({ data: {
      farmId, userId, action: "VISION_SCHEDULE_CHANGED", entity: "VisionSchedule", entityId: SCHEDULE_KEY,
      beforeJson: before?.value ?? null, afterJson: value,
    } });
  });
}

async function writeState(state: ScheduleState) {
  const farmId = currentFarmId();
  const value = JSON.stringify(state);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: STATE_KEY } }, create: { farmId, key: STATE_KEY, value }, update: { value } });
}

/** Hold the farm for this round, or null when another round is still running. */
async function claimRound(now: Date): Promise<ScheduleState | null> {
  const farmId = currentFarmId();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"vision-auto:" + farmId}, 0))::text`;
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: STATE_KEY } }, select: { value: true } });
    const state = readState(row?.value);
    if (state.leaseUntil && Date.parse(state.leaseUntil) > now.getTime()) return null;
    state.leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
    const value = JSON.stringify(state);
    await tx.setting.upsert({ where: { farmId_key: { farmId, key: STATE_KEY } }, create: { farmId, key: STATE_KEY, value }, update: { value } });
    return state;
  });
}

const safeKey = /^[A-Za-z0-9_-]+\.(jpg|png|webp|gif)$/;

/** Delete automatic pictures older than keep-days. The written result stays; only its picture goes. */
export async function pruneAutomaticPictures(keepDays: number, now: Date) {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000);
  const old = await prisma.visionMedia.findMany({
    where: { farmId: currentFarmId(), storageKey: { startsWith: AUTOMATIC_MEDIA_PREFIX }, createdAt: { lt: cutoff } },
    select: { id: true, storageKey: true }, take: 200, orderBy: { createdAt: "asc" },
  });
  const dir = visionStorageDir();
  let removed = 0;
  for (const media of old) {
    if (!safeKey.test(media.storageKey)) continue;
    await prisma.$transaction(async (tx) => {
      await tx.healthObservation.updateMany({ where: { farmId: currentFarmId(), visionMediaId: media.id }, data: { imageUrl: null } });
      await tx.visionMedia.delete({ where: { id: media.id } });
    });
    await unlink(path.join(dir, media.storageKey)).catch(() => undefined);
    removed++;
  }
  return removed;
}

export type FarmRoundResult = { farmId: string; ran: string[]; skipped?: string; pruned?: number };

/** One round for the current farm. */
export async function runFarmRound(schedule: Schedule, updatedBy: string | null, now: Date): Promise<FarmRoundResult> {
  const farmId = currentFarmId();
  if (!visionCamerasEnabled()) return { farmId, ran: [], skipped: "cameras-off" };
  // Loaded here (not at the top) because it also carries the web response helpers the timer does not need.
  const { farmFeatureAccess } = await import("@/lib/farm-feature-access");
  const access = await farmFeatureAccess().catch(() => ({ state: "UNAVAILABLE" as const }));
  if (access.state !== "PREMIUM" && access.state !== "EXISTING") return { farmId, ran: [], skipped: "plan" };
  if (updatedBy && !(await accountPreferences(farmId, updatedBy)).allowVisionImages) return { farmId, ran: [], skipped: "image-sharing-off" };
  if (inQuietHours(clockInZone(now, FARM_TIME_ZONE), schedule.quietStart, schedule.quietEnd)) return { farmId, ran: [], skipped: "quiet-hours" };

  const state = await claimRound(now);
  if (!state) return { farmId, ran: [], skipped: "round-running" };
  const today = calendarDateInTimeZone(now, FARM_TIME_ZONE) ?? now.toISOString().slice(0, 10);
  if (state.day !== today) { state.day = today; state.runsToday = 0; }
  const ran: string[] = [];
  try {
    const due = camerasToRun(schedule, state, now, today);
    if (due.length) {
      const cameras = await visionCameras().catch(() => []);
      for (const entry of due) {
        const matching = cameras.filter((c) => c.name === entry.name);
        const camera = matching.length === 1 ? matching[0] : null;
        if (!camera) {
          state.cameras[entry.name] = recordAttempt(state.cameras[entry.name], now, { ok: false, error: "The camera was not found. It may be offline or renamed." });
          continue;
        }
        if (!(await assignedCameraPen(camera))) {
          state.cameras[entry.name] = recordAttempt(state.cameras[entry.name], now, { ok: false, error: "Assign this camera to a pen on the Farm Vision page." });
          continue;
        }
        state.runsToday += 1;
        const result = await runVisionInspection({
          category: entry.category as never, batchId: null, notes: "", camera,
          video: entry.mode === "video" && visionLiveEnabled(), automatic: true,
        }).catch(() => ({ ok: false as const, status: 500, error: "The inspection failed unexpectedly." }));
        const line = recordAttempt(state.cameras[entry.name], new Date(), result.ok
          ? { ok: true, summary: result.analysis.summary, observationId: result.observation.id, severity: result.observation.severity }
          : { ok: false, error: result.error });
        if (result.ok) {
          line.birdsVisible = result.analysis.birdCount?.visible ?? null;
          line.questions = result.analysis.questions ?? [];
          line.escalate = result.analysis.escalate;
          // Same frames to Oriya (no second camera wake): its count, alerts and the WhatsApp message to the farm.
          line.oriya = await shareInspectionWithOriya({ cameraName: camera.name, penName: result.pen?.name ?? null, frames: result.frames, capturedAt: result.capturedAt, video: result.video })
            .catch(() => ({ sent: false, reason: "FAILED" }));
        }
        state.cameras[entry.name] = line;
        ran.push(entry.name);
      }
    }
    const pruned = await pruneAutomaticPictures(schedule.keepDays, now).catch(() => 0);
    return { farmId, ran, pruned };
  } finally {
    state.leaseUntil = "";
    state.lastRoundAt = now.toISOString();
    await writeState(state);
  }
}

/** Every farm that switched automatic inspections on. Called by the internal timer route. */
export async function runVisionRounds(now = new Date()) {
  const rows = await runUnscoped(() => prisma.setting.findMany({ where: { key: SCHEDULE_KEY }, select: { farmId: true, value: true } }));
  const results: (FarmRoundResult | { farmId: string; error: string })[] = [];
  for (const row of rows) {
    const schedule = readSchedule(row.value);
    if (!schedule?.enabled) continue;
    let updatedBy: string | null = null;
    try { const v = JSON.parse(row.value) as StoredSchedule; updatedBy = typeof v.updatedBy === "string" ? v.updatedBy : null; } catch { /* readSchedule already checked */ }
    results.push(await runAsFarm(row.farmId, () => runFarmRound(schedule, updatedBy, now))
      .catch(() => ({ farmId: row.farmId, error: "round failed" })));
  }
  return results;
}
