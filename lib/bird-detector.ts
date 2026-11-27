import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { summariseDetections } from "@/lib/detector-rules.mjs";

/**
 * The bird counter (Vision Intelligence phase 2): a separate detector service (services/detector) that finds each bird
 * in a picture. Built to run on its own GPU machine, so it scales apart from the web app, and SWITCHED OFF until then.
 *
 * It runs only when all of these are set:
 *   VISION_DETECTOR=on, DETECTOR_URL (https, or http on this machine), DETECTOR_TOKEN (32+ characters)
 * and the farm's own switch is on (Setting VISION_DETECTOR = "on"). When it is off, slow or down, inspections carry on
 * exactly as before; the counter only adds facts.
 */
const FARM_KEY = "VISION_DETECTOR";
const TIMEOUT_MS = 12_000;
const MAX_IN_FLIGHT = 4;
let inFlight = 0;

export function detectorConfigured() {
  if (process.env.VISION_DETECTOR !== "on") return false;
  const token = process.env.DETECTOR_TOKEN ?? "";
  try {
    const url = new URL(process.env.DETECTOR_URL ?? "");
    const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    return (url.protocol === "https:" || local) && !url.username && !url.password && token.length >= 32;
  } catch {
    return false;
  }
}

export async function detectorOnForFarm() {
  if (!detectorConfigured()) return false;
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: FARM_KEY } }, select: { value: true } });
  return row?.value === "on";
}

export async function setDetectorForFarm(on: boolean) {
  const farmId = currentFarmId(), value = on ? "on" : "off";
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: FARM_KEY } }, create: { farmId, key: FARM_KEY, value }, update: { value } });
}

const isBox = (b: unknown): b is number[] => Array.isArray(b) && b.length >= 5 && b.slice(0, 5).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1.0001);

/** Count the birds in up to 3 pictures (JPEG). Returns null when the counter is off, busy, slow or gives a bad answer. */
export async function countBirds(frames: Buffer[], fetcher: typeof fetch = fetch) {
  if (!frames.length || !(await detectorOnForFarm())) return null;
  if (inFlight >= MAX_IN_FLIGHT) return null;   // never queue behind a slow detector; the check goes on without it
  inFlight += 1;
  try {
    const response = await fetcher(new URL("/detect", process.env.DETECTOR_URL).href, {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error",
      headers: { authorization: `Bearer ${process.env.DETECTOR_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ images: frames.slice(0, 3).map((f) => f.toString("base64")) }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { model?: unknown; frames?: { boxes?: unknown[] }[] };
    if (!Array.isArray(data.frames) || data.frames.length !== Math.min(3, frames.length)) return null;
    const boxes = data.frames.map((f) => (Array.isArray(f?.boxes) ? f.boxes.filter(isBox).slice(0, 5000) : []));
    return summariseDetections(boxes, typeof data.model === "string" ? data.model.slice(0, 80) : "detector");
  } catch {
    return null;
  } finally {
    inFlight -= 1;
  }
}
