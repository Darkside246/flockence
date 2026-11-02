// SwitchBot thermometers through SwitchBot's cloud (OpenAPI v1.1), for live readings (docs/ORIYA_LINK.md, 2026-11-02).
// Pure functions only (no network), so node --test can check them directly.
//
// Needs a SwitchBot Hub (the thermometers report to the cloud through it) and, from the SwitchBot app
// (Profile > Preferences > About > tap App Version 10 times > Developer Options), a token and a secret, kept in
// .env only. Which thermometers to read: SWITCHBOT_THERMOMETERS="Thermo 1=<device id>,Floor 2=<device id>".
import { createHmac, randomUUID } from "node:crypto";

export const SWITCHBOT_API = "https://api.switch-bot.com";
const SENSOR = /^[A-Za-z0-9_. -]{1,40}$/;
const DEVICE = /^[A-Za-z0-9_-]{4,64}$/;

/** The token, secret and thermometers from the environment, or null when anything is missing or malformed. */
export function switchbotConfig(env) {
  const token = String(env.SWITCHBOT_TOKEN ?? "").trim();
  const secret = String(env.SWITCHBOT_SECRET ?? "").trim();
  if (token.length < 20 || secret.length < 8) return null;
  const thermometers = new Map();
  for (const part of String(env.SWITCHBOT_THERMOMETERS ?? "").split(",")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    const deviceId = part.slice(at + 1).trim();
    if (SENSOR.test(name) && DEVICE.test(deviceId)) thermometers.set(name, deviceId);
    if (thermometers.size >= 10) break;
  }
  return { token, secret, thermometers };
}

/** SwitchBot's signed headers: sign = base64(HMAC-SHA256(secret, token + t + nonce)). */
export function switchbotHeaders(token, secret, t = Date.now(), nonce = randomUUID()) {
  const sign = createHmac("sha256", secret).update(`${token}${t}${nonce}`).digest("base64");
  return { Authorization: token, sign, nonce, t: String(t), "Content-Type": "application/json; charset=utf8" };
}

/** One device status answer as a reading, or null when it is not a thermometer answer or the numbers are impossible. */
export function readingFromStatus(json) {
  if (!json || typeof json !== "object" || json.statusCode !== 100 || !json.body || typeof json.body !== "object") return null;
  const temperatureC = Number(json.body.temperature);
  const humidity = json.body.humidity === undefined || json.body.humidity === null ? null : Number(json.body.humidity);
  if (!Number.isFinite(temperatureC) || temperatureC < -20 || temperatureC > 70) return null;
  if (humidity !== null && (!Number.isFinite(humidity) || humidity < 0 || humidity > 100)) return null;
  return { temperatureC: Math.round(temperatureC * 100) / 100, humidityPct: humidity === null ? null : Math.round(humidity * 100) / 100 };
}

/** The device list, reduced to what is needed to fill in SWITCHBOT_THERMOMETERS: id, name, type. */
export function thermometersFromDeviceList(json) {
  const list = json?.statusCode === 100 && Array.isArray(json.body?.deviceList) ? json.body.deviceList : [];
  return list
    .filter((d) => typeof d?.deviceId === "string" && /meter|thermo|hygro|sensor|hub 2|hub3|hub 3/i.test(String(d.deviceType ?? "")))
    .map((d) => ({ deviceId: d.deviceId, name: String(d.deviceName ?? "").slice(0, 60), type: String(d.deviceType ?? "") }));
}

/** Readings sent to Flockence's own intake route by any other thermometer bridge: strict, at most 500 at once. */
export function readIntakeBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "readings")) return null;
  const list = body.readings;
  if (!Array.isArray(list) || list.length === 0 || list.length > 500) return null;
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || Object.keys(r).some((k) => !["sensor", "readAt", "temperatureC", "humidityPct"].includes(k))) return null;
    if (typeof r.sensor !== "string" || !SENSOR.test(r.sensor.trim())) return null;
    const at = typeof r.readAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(r.readAt) ? new Date(r.readAt) : null;
    if (!at || Number.isNaN(at.getTime())) return null;
    if (typeof r.temperatureC !== "number" || !Number.isFinite(r.temperatureC) || r.temperatureC < -20 || r.temperatureC > 70) return null;
    if (r.humidityPct !== undefined && r.humidityPct !== null && (typeof r.humidityPct !== "number" || !Number.isFinite(r.humidityPct) || r.humidityPct < 0 || r.humidityPct > 100)) return null;
    out.push({ sensor: r.sensor.trim(), readAt: at, temperatureC: r.temperatureC, humidityPct: r.humidityPct ?? null });
  }
  return out;
}

/** How often the SwitchBot cloud is asked (its limit is 10,000 calls a day for all devices). */
export const POLL_EVERY_MINUTES = 5;
