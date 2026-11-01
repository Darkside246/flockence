// Server-side client for the local Blink sidecar (services/blink). The sidecar
// listens on loopback only and trusts this shared token; browsers never see it.
const BASE = process.env.BLINK_SIDECAR_URL || "http://127.0.0.1:8765";

export const blinkConfigured = () => Boolean(process.env.BLINK_SIDECAR_TOKEN);

export async function blinkFetch(path: string, init: RequestInit = {}, timeoutMs = 45_000) {
  return fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers || {}), "X-Sidecar-Token": process.env.BLINK_SIDECAR_TOKEN || "" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
