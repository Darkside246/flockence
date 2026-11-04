import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import type { FarmAccessRole } from "@/lib/current-user";
import { currentCameraService } from "@/lib/blink-sidecar";

/**
 * Who may see the cameras, how often, and the headers that keep the video on this site (security review 2026-11-01).
 *
 *  - CAMERA_VIEW_ROLES: comma list of roles that may view (default OWNER,MANAGER,WORKER; READ_ONLY cannot).
 *  - A per-person allowance per minute (CAMERA_REQUESTS_PER_MINUTE, default 600). One live stream needs about 60
 *    (a playlist and a 2-second segment, polled), so ordinary viewing never meets it; a script hammering the cameras does.
 *  - Headers: the video may not be embedded, fetched or cached by any other site, and no address leaks in Referer.
 */
const ALL_ROLES: FarmAccessRole[] = ["OWNER", "MANAGER", "WORKER", "READ_ONLY"];

/** Only farms with their own camera service can use the camera routes. */
export function camerasBelongToThisFarm(): boolean {
  return currentCameraService() !== null;
}

export function cameraViewRoles(env: Record<string, string | undefined> = process.env): FarmAccessRole[] {
  const listed = String(env.CAMERA_VIEW_ROLES ?? "OWNER,MANAGER,WORKER").split(",").map((r) => r.trim().toUpperCase());
  const roles = ALL_ROLES.filter((r) => listed.includes(r));
  return roles.length ? roles : ["OWNER"];
}

const windows = new Map<string, { start: number; count: number }>();
/** In-memory fixed window per person; cheap enough for video segment requests (no database write per segment). */
export function cameraRequestAllowed(userId: string, now = Date.now(), limit = Number(process.env.CAMERA_REQUESTS_PER_MINUTE || 600)): boolean {
  const current = windows.get(userId);
  if (!current || now - current.start >= 60_000) {
    if (windows.size > 5000) windows.clear();
    windows.set(userId, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function hardenCameraHeaders(headers: Headers) {
  headers.set("cache-control", "no-store, private");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  headers.set("x-robots-tag", "noindex, nofollow");
}

/** Who started or stopped live video, kept in the audit log (no picture, no camera address). */
export async function auditCameraAction(userId: string, action: string, camera: string) {
  try {
    await prisma.auditLog.create({ data: { farmId: currentFarmId(), userId, action, entity: "Camera", entityId: camera.slice(0, 80) } });
  } catch {
    // Auditing must not take the camera down; a failure here is visible in the server log only.
    console.error("[camera-guard] audit write failed");
  }
}
