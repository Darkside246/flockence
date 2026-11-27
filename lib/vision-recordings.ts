import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";
import { assignedCameraPen } from "@/lib/vision-camera-pens";
import { recentCameraClips, recordedClipFrames, visionCameras } from "@/lib/vision-camera";
import { runVisionInspection } from "@/lib/vision-inspection";
import { markChecked, missingParts, pickRecordingChecks, RECORDINGS_PER_ROUND, type Clip, type RecordingState } from "@/lib/vision-recording-rules.mjs";

/**
 * Recording checks across the day (Vision Intelligence phase 3). Run from the automatic round when the farm switched
 * "Also check recordings" on: for each scheduled camera, one saved clip from each part of the last 24 hours not checked
 * yet (lib/vision-recording-rules.mjs), three frames from it (services/blink/clip_frames.py), and a normal inspection
 * filed at the time it was filmed. Each is a paid vision call within the plan's daily limit. Parts of the day with no
 * recording are kept, so the schedule card can say which are missing.
 */
const STATE_KEY = "VISION_RECORDING_STATE";
export type RecordingStatus = RecordingState & { missing?: Record<string, string[]>; checkedAt?: string };

const hourOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(d));

export async function loadRecordingStatus(): Promise<RecordingStatus | null> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: STATE_KEY } }, select: { value: true } });
  try { return row ? JSON.parse(row.value) as RecordingStatus : null; } catch { return null; }
}

async function saveRecordingStatus(state: RecordingStatus) {
  const farmId = currentFarmId(), value = JSON.stringify(state);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: STATE_KEY } }, create: { farmId, key: STATE_KEY, value }, update: { value } });
}

/** Check up to `budget` (and at most RECORDINGS_PER_ROUND) recordings. Returns what ran and how many calls it used. */
export async function runRecordingChecks(cameraNames: string[], budget: number, now: Date, deps = { recentCameraClips, recordedClipFrames, visionCameras, runVisionInspection }) {
  if (budget < 1 || !cameraNames.length) return { ran: [] as string[], used: 0 };
  const cameras = (await deps.visionCameras().catch(() => [])).filter((c) => cameraNames.includes(c.name));
  const clips: Clip[] = [];
  for (const c of cameras) clips.push(...await deps.recentCameraClips(c.name).catch(() => []));
  let state: RecordingStatus = (await loadRecordingStatus()) ?? { done: {}, covered: {} };
  const picks = pickRecordingChecks(clips, state, now, hourOf, Math.min(budget, RECORDINGS_PER_ROUND), cameras.map((c) => c.name));
  const ran: string[] = [];
  let used = 0;
  for (const pick of picks) {
    const camera = cameras.find((c) => c.name === pick.camera)!;
    if (!(await assignedCameraPen(camera))) { state = { ...state, ...markChecked(state, pick, now) }; continue; }
    const frames = await deps.recordedClipFrames({ source: pick.clip.source, media: pick.clip.media ?? "" }).catch(() => null);
    if (!frames?.length) { state = { ...state, ...markChecked(state, pick, now) }; continue; }   // unreadable clip: skip it, not forever retry
    used += 1;
    const result = await deps.runVisionInspection({
      category: "PEN", batchId: null, notes: "", camera, automatic: true, recording: { frames, clipAt: new Date(pick.clip.createdAt) },
    }).catch(() => ({ ok: false as const, status: 500, error: "failed" }));
    if (result.ok) { state = { ...state, ...markChecked(state, pick, now) }; ran.push(`${pick.camera} (${pick.part} recording)`); }
  }
  state.missing = missingParts(clips, cameras.map((c) => c.name), now, hourOf);
  state.checkedAt = now.toISOString();
  await saveRecordingStatus(state);
  return { ran, used };
}
