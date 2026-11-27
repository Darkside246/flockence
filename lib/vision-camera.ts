import { blinkConfigured, blinkFetch } from "@/lib/blink-sidecar";
import { cameraViewRoles } from "@/lib/camera-guard";
import type { FarmAccessRole } from "@/lib/current-user";
import { boundedBody } from "@/lib/camera-gateway-http";

export const maxVisionImageBytes = 8 * 1024 * 1024;

export type VisionCamera = { name: string; source: "blink" | "rtsp"; deviceKey: string };

export function visionCameraRoles(): FarmAccessRole[] {
  return cameraViewRoles().filter((role) => role === "OWNER" || role === "MANAGER");
}

export function visionCamerasEnabled() {
  return process.env.FLOCKENCE_CAMERA_VISION === "on" && blinkConfigured();
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
  const path = "/cameras/" + encodeURIComponent(camera.name) + "/snapshot?fresh=true";
  const response = await blinkFetch(path, {}, 20_000);
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg") return null;
  const bytes = await boundedBody(response, maxVisionImageBytes);
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return { camera, bytes, capturedAt: new Date() };
}

export async function captureVisionVideoSample(camera: VisionCamera) {
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
