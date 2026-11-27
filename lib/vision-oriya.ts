import { allowedCameras, frameFromBytes, type OriyaFrame } from "@/lib/oriya-link.mjs";
import { farmLinkConfig } from "@/lib/oriya-farm-link";
import { camerasBelongToThisFarm } from "@/lib/camera-guard";
import { currentClimate, keepAlerts, postToOriya, referenceFor } from "@/lib/oriya";
import { farmOffset, isoWithOffset } from "@/lib/climate.mjs";

export type OriyaShare = { sent: boolean; reason?: string; alerts?: number; birdsVisible?: number | null; whatsapp?: boolean };

/**
 * After an automatic inspection, send the same frames to Oriya over the existing signed link
 * (POST /api/public/farm/chicken-op/flock-snapshots, docs/ORIYA_LINK.md). The camera is not woken a second time.
 * Oriya counts the birds it sees, raises alerts from fixed rules, and sends the WhatsApp message to the farm (Oriya's
 * FLOCK_ALERTS_WHATSAPP switch). Its alerts are kept here as health observations, like the scheduled Oriya push does.
 * Only cameras the farm already shares with Oriya (ORIYA_CAMERAS) are sent, by their code, never by name or address.
 */
export async function shareInspectionWithOriya(input: { cameraName: string; penName: string | null; frames: Buffer[]; capturedAt: Date; video: boolean }): Promise<OriyaShare> {
  const config = await farmLinkConfig().catch(() => null);
  if (!config) return { sent: false, reason: "NOT_LINKED" };
  if (!camerasBelongToThisFarm()) return { sent: false, reason: "CAMERAS_NOT_SHARED" };
  const code = [...allowedCameras(process.env)].find(([, name]) => name === input.cameraName)?.[0];
  if (!code) return { sent: false, reason: "CAMERA_NOT_SHARED" };
  const frames = input.frames.slice(0, 3).map((bytes, i) => frameFromBytes(bytes, i * 3)).filter((f): f is OriyaFrame => Boolean(f));
  if (!frames.length) return { sent: false, reason: "NO_USABLE_FRAME" };
  const now = new Date();
  const reference = input.video ? await referenceFor(code, frames, now).catch(() => null) : null;
  const climate = await currentClimate(now).catch(() => []);
  const fallbackHouse = process.env.ORIYA_HOUSE || "Main";
  const house = input.penName && /^[A-Za-z0-9_. -]{1,40}$/.test(input.penName) ? input.penName : /^[A-Za-z0-9_. -]{1,40}$/.test(fallbackHouse) ? fallbackHouse : "Main";
  const snapshot = {
    eventId: `vision-${Date.now()}-${code.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "cam"}`, type: "FLOCK_SNAPSHOT",
    occurredAt: isoWithOffset(input.capturedAt, farmOffset(process.env)), house, camera: code, source: "BLINK",
    kind: input.video ? "LIVE_VIEW" : "THUMBNAIL", frames,
    ...(reference ? { reference } : {}), ...(climate.length ? { climate } : {}),
  };
  const reply = await postToOriya(config, "/api/public/farm/chicken-op/flock-snapshots", snapshot).catch(() => null);
  if (!reply) return { sent: false, reason: "UNREACHABLE" };
  if (reply.status !== 201) return { sent: false, reason: `REFUSED_${reply.status}` };
  const answer = reply.json as { sent?: unknown; findings?: { birdsVisible?: unknown } } | null;
  const birds = answer?.findings?.birdsVisible;
  return {
    sent: true,
    alerts: await keepAlerts(reply.json as never, `Farm Vision camera ${code}`).catch(() => 0),
    birdsVisible: typeof birds === "number" && Number.isInteger(birds) && birds >= 0 ? birds : null,
    whatsapp: answer?.sent === true,
  };
}
