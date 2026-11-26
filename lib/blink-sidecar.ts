import { currentFarmIdOrNull, DEFAULT_FARM_ID } from "@/lib/farm-scope";

type CameraWorker = { url: string; token: string; networkCameras: boolean };
type CameraEnv = Record<string, string | undefined>;

const farmIdPattern = /^[A-Za-z0-9_-]{3,64}$/;
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

function loopbackUrl(value: string): string | null {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(value);
  return match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535
    ? "http://127.0.0.1:" + match[1] : null;
}

// Every configured farm must have a distinct worker and token. The existing
// install-wide service is reserved for the default farm.
export function cameraWorkerForFarm(farmId: string | null, env: CameraEnv = process.env, defaultFarm = DEFAULT_FARM_ID): CameraWorker | null {
  if (!farmId || !farmIdPattern.test(farmId)) return null;
  const legacyUrl = loopbackUrl(env.BLINK_SIDECAR_URL || "http://127.0.0.1:8765");
  const legacyToken = env.BLINK_SIDECAR_TOKEN ?? "";
  if (farmId === defaultFarm) {
    return legacyUrl && tokenPattern.test(legacyToken)
      ? { url: legacyUrl, token: legacyToken, networkCameras: true } : null;
  }

  let config: unknown;
  try { config = JSON.parse(env.FLOCKENCE_CAMERA_WORKERS ?? "{}"); } catch { return null; }
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;

  const usedUrls = new Set([legacyUrl, "http://127.0.0.1:8765"]);
  const usedTokens = new Set([legacyToken]);
  let result: CameraWorker | null = null;
  for (const [id, value] of Object.entries(config)) {
    if (!farmIdPattern.test(id) || id === defaultFarm || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const { url: rawUrl, token } = value as Record<string, unknown>;
    const url = typeof rawUrl === "string" ? loopbackUrl(rawUrl) : null;
    if (!url || typeof token !== "string" || !tokenPattern.test(token) || usedUrls.has(url) || usedTokens.has(token)) return null;
    usedUrls.add(url);
    usedTokens.add(token);
    if (id === farmId) result = { url, token, networkCameras: false };
  }
  return result;
}

export function cameraWorker() {
  return cameraWorkerForFarm(currentFarmIdOrNull());
}

export const blinkConfigured = () => Boolean(cameraWorker());

export async function blinkFetch(path: string, init?: RequestInit, timeoutMs = 45_000) {
  const worker = cameraWorker();
  if (!worker || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("Camera worker unavailable");
  const headers = new Headers(init?.headers);
  headers.set("X-Sidecar-Token", worker.token);
  return fetch(worker.url + path, {
    ...init,
    cache: "no-store",
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
