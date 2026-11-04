// Additional camera services are operator-provisioned loopback instances with separate data directories.
export function farmCameraService(farmId, defaultFarm, env) {
  if (!farmId) return null;
  const primary = {url:env.BLINK_SIDECAR_URL || "http://127.0.0.1:8765",token:env.BLINK_SIDECAR_TOKEN || ""};
  if (farmId===defaultFarm) return primary;
  try {
    const services = JSON.parse(env.FARM_CAMERA_SERVICES || "{}");
    const entry = Object.hasOwn(services,farmId) && services[farmId];
    if (!entry || !Number.isInteger(entry.port) || entry.port<1 || entry.port>65535 || typeof entry.token!=="string" || entry.token.length<32) return null;
    const primaryUrl = new URL(primary.url);
    const primaryPort = Number(primaryUrl.port || (primaryUrl.protocol==="https:" ? 443 : 80));
    if (entry.port===primaryPort || entry.token===primary.token) return null;
    if (Object.entries(services).some(([id,other])=>id!==farmId && (other?.port===entry.port || other?.token===entry.token))) return null;
    return {url:"http://127.0.0.1:"+entry.port,token:entry.token};
  } catch { return null; }
}
