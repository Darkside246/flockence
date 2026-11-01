// Signed link between Flockence and Oriya (Oriya is the brain). See docs/ORIYA_LINK.md.
// Pure functions only (no database, no network), so node --test can check them directly.
//
// Both directions use the per-farm secret Oriya shows once when its Chicken Op link is made:
//   X-Oriya-Key:        cop_...            (Flockence -> Oriya only)
//   X-Oriya-Timestamp:  Unix seconds       (must be within 5 minutes)
//   X-Oriya-Signature:  v1=<hex HMAC-SHA256(secret, "v1:<timestamp>:<exact raw body>")>
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_AGE_SECONDS = 300;
export const MAX_FRAMES = 3;
export const MAX_FRAME_BYTES = 1_500_000;
const KEY_ID = /^cop_[A-Za-z0-9_-]{24}$/;
const CODE = /^[A-Za-z0-9_. -]{1,40}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,80}$/;

/** The link settings from the server environment, or null when any is missing or unsafe. */
export function oriyaLinkConfig(env) {
  const secret = String(env.ORIYA_LINK_SECRET ?? "");
  const keyId = String(env.ORIYA_LINK_KEY_ID ?? "");
  if (secret.length < 32 || !KEY_ID.test(keyId)) return null;
  try {
    const url = new URL(String(env.ORIYA_URL ?? ""));
    const allowed = String(env.ORIYA_ALLOWED_HOST ?? "oriya.si").toLowerCase();
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !(host === allowed || host.endsWith(`.${allowed}`))) return null;
    return { baseUrl: url.origin, keyId, secret };
  } catch {
    return null;
  }
}

export function signOriyaBody(secret, timestamp, rawBody) {
  return `v1=${createHmac("sha256", secret).update(`v1:${timestamp}:`).update(rawBody).digest("hex")}`;
}

/** Checks a request Oriya signed: the 5-minute window and the signature over the exact bytes received. */
export function verifyOriyaSignature(secret, timestampHeader, signatureHeader, rawBody, nowMs = Date.now()) {
  const timestamp = /^\d{9,11}$/.test(timestampHeader ?? "") ? Number(timestampHeader) : Number.NaN;
  if (!Number.isFinite(timestamp) || Math.abs(nowMs / 1000 - timestamp) > MAX_AGE_SECONDS) return { ok: false, reason: "TOO_OLD" };
  if (!secret) return { ok: false, reason: "BAD_SIGNATURE" };
  const expected = Buffer.from(signOriyaBody(secret, timestamp, rawBody));
  const given = Buffer.from(String(signatureHeader ?? ""));
  const same = expected.length === given.length && timingSafeEqual(expected, given);
  expected.fill(0);
  return same ? { ok: true, timestamp } : { ok: false, reason: "BAD_SIGNATURE" };
}

/**
 * Which cameras Oriya may ask for: ORIYA_CAMERAS as "code=Blink camera name" pairs, comma separated, e.g.
 * "Coop 1=Outdoor 4 Front,Coop 2=Mini Back". The code is what Oriya sees; the Blink name never leaves Flockence.
 */
export function allowedCameras(env) {
  const map = new Map();
  for (const part of String(env.ORIYA_CAMERAS ?? "").split(",")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const code = part.slice(0, at).trim();
    const name = part.slice(at + 1).trim();
    if (CODE.test(code) && name && name.length <= 80) map.set(code, name);
  }
  return map;
}

/** Oriya's "check camera now" request body, strictly: { requestId, camera, frames 1-3, secondsApart 1-10 }. */
export function readFrameRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.some((k) => !["requestId", "camera", "frames", "secondsApart"].includes(k))) return null;
  const { requestId, camera, frames = 3, secondsApart = 3 } = body;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return null;
  if (typeof camera !== "string" || !CODE.test(camera)) return null;
  if (!Number.isInteger(frames) || frames < 1 || frames > MAX_FRAMES) return null;
  if (!Number.isInteger(secondsApart) || secondsApart < 1 || secondsApart > 10) return null;
  return { requestId, camera, frames, secondsApart };
}

/** The kind of picture by its first bytes (never the declared type), or null. */
export function imageKind(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** A frame for Oriya, or null when the bytes are not a real picture or are too big. */
export function frameFromBytes(bytes, secondsAfterFirst) {
  const kind = imageKind(bytes);
  if (!kind || bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) return null;
  return { mimeType: kind, imageBase64: bytes.toString("base64"), secondsAfterFirst };
}

/**
 * The FLOCK_CHECK Oriya expects, from numbers Flockence already holds. Only the allowed fields; no names, phone
 * numbers, camera addresses or tokens ever go in.
 */
export function buildFlockCheck({ eventId, occurredAt, house, deathsSince, deaths, causes, feedStockKg, feedUsedKg24h, alive, ageDays, temperatureC, openHealthCases }) {
  const check = { eventId, type: "FLOCK_CHECK", occurredAt, house, source: "BLINK", cameras: [] };
  check.mortality = { since: deathsSince, count: Math.max(0, Math.round(deaths)) };
  const causeList = Object.entries(causes ?? {}).filter(([, n]) => n > 0).map(([cause, count]) => ({ cause, count }));
  if (causeList.length) check.mortality.causes = causeList;
  if (Number.isFinite(feedStockKg) && feedStockKg >= 0) {
    check.feed = { stockKg: Math.round(feedStockKg * 10) / 10 };
    if (Number.isFinite(feedUsedKg24h) && feedUsedKg24h >= 0) check.feed.usedKgLast24h = Math.round(feedUsedKg24h * 10) / 10;
  }
  if (Number.isInteger(alive) && alive >= 0) check.birds = Number.isInteger(ageDays) && ageDays >= 0 ? { alive, ageDays } : { alive };
  if (Number.isFinite(temperatureC)) check.temperatureC = Math.round(temperatureC * 10) / 10;
  if (Number.isInteger(openHealthCases) && openHealthCases >= 0) check.openHealthCases = openHealthCases;
  return check;
}

const CAUSES = ["UNKNOWN", "HEAT", "DISEASE", "INJURY", "PREDATOR", "CULLED", "OTHER"];
/** Flockence's free-text death reason, as one of Oriya's fixed causes (the text itself never leaves). */
export function deathCause(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (!text.trim()) return "UNKNOWN";
  if (/heat|hot|panting/.test(text)) return "HEAT";
  if (/cull/.test(text)) return "CULLED";
  if (/predator|dog|cat|rat|mongoose|hawk|snake/.test(text)) return "PREDATOR";
  if (/injur|trampl|crush|leg|peck/.test(text)) return "INJURY";
  if (/sick|disease|ill|infect|virus|cough|diarr/.test(text)) return "DISEASE";
  return CAUSES.includes(text.toUpperCase()) ? text.toUpperCase() : "OTHER";
}
