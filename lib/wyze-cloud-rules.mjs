import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Wyze cloud sign-in, the pure parts (28 Nov 2026). Wyze closed its old app login to outside apps in 2024 and now asks
 * every outside sign-in for the account's own API Key ID and API key, made at developer-api-console.wyze.com. The farm
 * owner signs in once with Wyze email, password, Key ID and key (and a two-factor code if the account has one); the
 * server keeps only the resulting tokens, encrypted. The request shapes follow the open-source docker-wyze-bridge
 * (mrlt8) and wyze-sdk (shauntarves) clients.
 */
export const AUTH_API = "https://auth-prod.api.wyze.com";
export const WYZE_API = "https://api.wyzecam.com/app";
export const APP_VERSION = "3.1.6.1";
const IOS_VERSION = "17.1.1";
/** The Wyze app's public auth key, used by both open-source clients for two-factor steps. */
const AUTH_APP_KEY = "RckMFKbsds5p6QY3COEXc2ABwNTYY0q18ziEiSEm";
const SC = "9f275790cab94a72bd206c8876429f3c";
const SV = "e1fe392906d54888a9b99b88de4162d7";

/** Wyze's password form: MD5 three times over the trimmed password. */
export function hashPassword(password) {
  let value = String(password).trim();
  for (let i = 0; i < 3; i++) value = createHash("md5").update(value, "utf8").digest("hex");
  return value;
}

export const newPhoneId = () => randomUUID();

export function loginHeaders(keyId, apiKey) {
  return { "content-type": "application/json", apikey: apiKey, keyid: keyId, "x-api-key": AUTH_APP_KEY, "user-agent": "flockence/1.0" };
}
export function authAppHeaders() {
  return { "content-type": "application/json", "x-api-key": AUTH_APP_KEY, "user-agent": "flockence/1.0" };
}
export function appHeaders() {
  return { "content-type": "application/json", "user-agent": `Wyze/${APP_VERSION} (iPhone; iOS ${IOS_VERSION}; Scale/3.00)`, appversion: APP_VERSION, env: "prod" };
}
export function appPayload(accessToken, phoneId, now = Date.now()) {
  return {
    sc: SC, sv: SV, app_ver: `com.hualai.WyzeCam___${APP_VERSION}`, app_version: APP_VERSION, app_name: "com.hualai.WyzeCam",
    phone_system_type: 1, ts: now, access_token: accessToken, phone_id: phoneId,
  };
}

/** Wyze answers with a code: 1 or 0 is fine, 2001 means the access token has expired. */
export function readWyzeAnswer(json) {
  const code = String(json?.code ?? json?.errorCode ?? 0);
  if (code === "2001") return { ok: false, expired: true, message: "The Wyze sign-in has expired." };
  if (code !== "0" && code !== "1") return { ok: false, expired: false, message: plainWyzeError(code, json?.msg ?? json?.description) };
  return { ok: true, data: json?.data ?? json };
}

function plainWyzeError(code, message) {
  const text = String(message ?? "").toLowerCase();
  if (code === "1000" || text.includes("password") || text.includes("credential") || text.includes("user not") || text.includes("incorrect")) return "Wyze did not accept that email and password.";
  if (text.includes("api key") || text.includes("apikey") || text.includes("keyid") || text.includes("key id")) return "Wyze did not accept the API Key ID and API key. Check both on developer-api-console.wyze.com.";
  if (text.includes("verification") || text.includes("code")) return "Wyze did not accept that code. Try the newest one.";
  if (text.includes("limit") || code === "429") return "Wyze is limiting sign-ins right now. Try again in a few minutes.";
  return "Wyze did not accept the sign-in" + (message ? `: ${String(message).slice(0, 120)}` : ".");
}

/**
 * What the login answer asks for next: done (tokens), a code from an authenticator app, a text message code, or a
 * refusal. Email two-factor is not offered by these clients, so it is reported plainly.
 */
export function readLogin(data) {
  if (data?.access_token && data?.refresh_token) return { step: "done", accessToken: String(data.access_token), refreshToken: String(data.refresh_token), userId: String(data.user_id ?? "") };
  const options = Array.isArray(data?.mfa_options) ? data.mfa_options : [];
  if (options.includes("TotpVerificationCode")) {
    const appId = data?.mfa_details?.totp_apps?.[0]?.app_id;
    if (appId) return { step: "totp", verificationId: String(appId), userId: String(data.user_id ?? "") };
  }
  if (options.includes("PrimaryPhone") && data?.sms_session_id) return { step: "sms", smsSessionId: String(data.sms_session_id), userId: String(data.user_id ?? "") };
  if (options.length) return { step: "refused", message: "This Wyze account uses a two-factor method Flockence cannot use yet. Switch Wyze two-factor to an authenticator app or text message, then try again." };
  return { step: "refused", message: "Wyze did not complete the sign-in. Check the email, password and API key." };
}

const MAC = /^[A-Za-z0-9:_-]{4,64}$/;
/** Cameras from the home page list: a stable id, a name, the model, and the latest cloud picture. */
export function readCameraList(data) {
  const devices = Array.isArray(data?.device_list) ? data.device_list : [];
  return devices.slice(0, 200).flatMap((d) => {
    if (d?.product_type !== "Camera" || typeof d?.mac !== "string" || !MAC.test(d.mac)) return [];
    const name = String(d.nickname || d.product_model || "Wyze camera").replace(/[\u0000-\u001f\u007f\/\\]/g, " ").trim().slice(0, 64) || "Wyze camera";
    const thumbnail = safeThumbnailUrl(d?.device_params?.camera_thumbnails?.thumbnails_url);
    const updatedAt = Number(d?.device_params?.camera_thumbnails?.thumbnails_ts);
    return [{ mac: d.mac, name, model: String(d.product_model ?? "").slice(0, 40), thumbnail, thumbnailAt: Number.isFinite(updatedAt) && updatedAt > 0 ? new Date(updatedAt < 1e12 ? updatedAt * 1000 : updatedAt).toISOString() : null }];
  });
}

/** Only Wyze's own picture stores, over https: the server never fetches an address a reply could point anywhere. */
export function safeThumbnailUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return /(^|\.)(amazonaws\.com|wyze\.com|wyzecam\.com)$/i.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

/** The same 64-character id shape other cameras use, so pen assignments work unchanged. */
export const wyzeDeviceKey = (mac) => createHash("sha256").update("wyze:" + mac.toLowerCase()).digest("hex");

/** Give each camera a name no other camera on the farm uses. */
export function uniqueNames(cameras, taken) {
  const used = new Set(taken);
  return cameras.map((c) => {
    let name = c.name;
    if (used.has(name)) name = `${c.name} (Wyze)`;
    for (let n = 2; used.has(name); n++) name = `${c.name} (Wyze ${n})`;
    used.add(name);
    return { ...c, name };
  });
}

const keyFrom = (authSecret) => createHash("sha256").update("flockence-wyze-cloud-v1:" + authSecret).digest();
export function seal(value, authSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(authSecret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function unseal(sealed, authSecret) {
  try {
    const [iv, tag, data] = String(sealed).split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(authSecret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
  } catch { return null; }
}

export const PENDING_MINUTES = 10;
export const validCode = (code) => typeof code === "string" && /^\d{4,8}$/.test(code.trim());

/** Is a cloud picture taken at `takenAt` (ISO) recent enough to check? */
export function freshEnough(takenAt, now = Date.now(), maxMinutes = Number(process.env.WYZE_MAX_PICTURE_AGE_MINUTES) || 180) {
  const at = takenAt ? Date.parse(takenAt) : NaN;
  return Number.isFinite(at) && at <= now + 5 * 60_000 && now - at <= maxMinutes * 60_000;
}
