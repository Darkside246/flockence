import { blinkConfigured, blinkFetch } from "@/lib/blink-sidecar";
import { cameraViewRoles } from "@/lib/camera-guard";
import type { FarmAccessRole } from "@/lib/current-user";
import { boundedBody } from "@/lib/camera-gateway-http";
import { wyzeCloudEnabled, wyzeCloudSnapshot, wyzeVisionCameras } from "@/lib/wyze-cloud";

export const maxVisionImageBytes = 8 * 1024 * 1024;

export type VisionCamera = { name: string; source: "blink" | "rtsp" | "wyze"; deviceKey: string };

export function visionCameraRoles(): FarmAccessRole[] {
  return cameraViewRoles().filter((role) => role === "OWNER" || role === "MANAGER");
}

export function visionCamerasEnabled() {
  return process.env.FLOCKENCE_CAMERA_VISION === "on" && (blinkConfigured() || wyzeCloudEnabled());
}

export function visionLiveEnabled() {
  return process.env.FLOCKENCE_LIVE_CAMERA_VISION === "on" && visionCamerasEnabled();
}

export function validVisionCameraName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 128
    && name !== "." && name !== ".." && !/[\/\\\u0000-\u001f\u007f]/.test(name);
}

export async function visionCameras(): Promise<VisionCamera[]> {
  if (!visionCamerasEnabled()) return [];
  const blink = blinkConfigured() ? await blinkVisionCameras() : [];
  // Wyze cameras signed in through the farm's Wyze account (lib/wyze-cloud.ts). A Wyze outage never hides the others.
  const wyze = await wyzeVisionCameras(blink.map((c) => c.name)).catch(() => []);
  return [...blink, ...wyze];
}

async function blinkVisionCameras(): Promise<VisionCamera[]> {
  const response = await blinkFetch("/cameras", {}, 5000);
  const raw = response.ok ? await boundedBody(response, 128 * 1024) : null;
  if (!raw) throw new Error("Camera list is unavailable.");
  const cams: unknown = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(cams)) throw new Error("Camera list is unavailable.");
  return cams.slice(0, 256).flatMap((camera) => {
    if (!validVisionCameraName(camera?.name) || (camera?.source !== "blink" && camera?.source !== "rtsp")) return [];
    const deviceKey = typeof camera.deviceKey === "string" && /^[a-f0-9]{64}$/.test(camera.deviceKey)
      ? camera.deviceKey : camera.name;
    return [{ name: camera.name, source: camera.source, deviceKey }];
  });
}

export async function visionCameraByName(name: string) {
  const matching = (await visionCameras()).filter(entry => entry.name === name);
  return matching.length === 1 ? matching[0] : null;
}

export async function captureVisionCamera(camera: VisionCamera) {
  if (camera.source === "wyze") {
    const shot = await wyzeCloudSnapshot(camera.deviceKey, maxVisionImageBytes);
    return shot ? { camera, bytes: shot.bytes, capturedAt: shot.takenAt ?? new Date() } : null;
  }
  const path = "/cameras/" + encodeURIComponent(camera.name) + "/snapshot?fresh=true";
  const response = await blinkFetch(path, {}, 20_000);
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg") return null;
  const bytes = await boundedBody(response, maxVisionImageBytes);
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return { camera, bytes, capturedAt: new Date() };
}

/** Saved clips from the last 24 hours for one camera (Blink cloud, the server's recordings and the archive). */
export async function recentCameraClips(cameraName: string) {
  if (!blinkConfigured()) return [];
  const response = await blinkFetch("/clips?period=1&camera=" + encodeURIComponent(cameraName), {}, 20_000);
  const raw = response.ok ? await boundedBody(response, 512 * 1024) : null;
  if (!raw) return [];
  const data = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(data)) return [];
  return data.flatMap((c) => c && typeof c.id === "string" && c.camera === cameraName && typeof c.createdAt === "string" && typeof c.media === "string"
    && ["blink", "rtsp", "archive"].includes(c.source) ? [{ id: `${c.source}:${c.id}`.slice(0, 200), camera: c.camera as string, createdAt: c.createdAt as string, source: c.source as string, media: c.media as string }] : []);
}

/** Three frames (start, middle, end) from a saved clip, taken by the camera service (services/blink/clip_frames.py). */
export async function recordedClipFrames(clip: { source: string; media: string }) {
  const response = await blinkFetch("/clips/frames", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: clip.source, media: clip.media }) }, 90_000);
  const raw = response.ok ? await boundedBody(response, 2200 * 1024) : null;
  if (!raw) return null;
  const data = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(data?.frames) || !data.frames.length || data.frames.length > 3) return null;
  const frames: Buffer[] = [];
  for (const frame of data.frames) {
    if (typeof frame !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame)) return null;
    const bytes = Buffer.from(frame, "base64");
    if (bytes.length < 5 || bytes.length > 512 * 1024 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return null;
    frames.push(bytes);
  }
  return frames;
}

export async function captureVisionVideoSample(camera: VisionCamera) {
  // Wyze cloud pictures are single stills; a video sample needs the camera service.
  if (camera.source === "wyze" || !blinkConfigured()) return null;
  const path = "/cameras/" + encodeURIComponent(camera.name) + "/inspection-sample";
  const response = await blinkFetch(path, { method: "POST" }, 58_000);
  const raw = response.ok ? await boundedBody(response, 1100 * 1024) : null;
  if (!raw) return null;
  const data = JSON.parse(raw.toString("utf8"));
  const capturedAt = new Date(typeof data?.capturedAt === "string" ? data.capturedAt : "");
  if (!Number.isFinite(capturedAt.getTime()) || !Array.isArray(data.frames) || data.frames.length !== 3) return null;
  const samples: Buffer[] = [];
  for (const frame of data.frames) {
    if (typeof frame !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame)) return null;
    const bytes = Buffer.from(frame, "base64");
    if (bytes.length < 5 || bytes.length > 256 * 1024 || bytes.toString("base64") !== frame
      || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
    samples.push(bytes);
  }
  return { camera, bytes: samples[0], capturedAt, samples };
}
