// Server-side client for the local Blink sidecar (services/blink). The sidecar
// listens on loopback only and trusts this shared token; browsers never see it.
import { currentFarmIdOrNull, DEFAULT_FARM_ID } from "@/lib/farm-scope";
import { farmCameraService } from "./farm-camera-service.mjs";

export const currentCameraService = () => farmCameraService(currentFarmIdOrNull(),DEFAULT_FARM_ID,process.env);
export const blinkConfigured = () => Boolean(currentCameraService()?.token);

export async function blinkFetch(path: string, init: RequestInit = {}, timeoutMs = 45_000) {
  const service = currentCameraService();
  if (!service?.token) throw new Error("Camera service is not configured for this farm");
  return fetch(`${service.url}${path}`, {
    ...init,
    redirect: "error",
    cache: "no-store",
    headers: { ...(init.headers || {}), "X-Sidecar-Token": service.token },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
