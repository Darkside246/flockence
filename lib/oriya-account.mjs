// One account for Oriya and Flockence (2026-11-02). Pure functions only, so node --test can check them directly.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,80}$/;
const KEY_ID = /^cop_[A-Za-z0-9_-]{24}$/;

/** The farm id for an Oriya business: fixed, so setting up again updates the same farm. */
export function farmIdForBusiness(businessId) {
  return `oriya-${businessId}`;
}

/** Oriya's setup request, strictly: any other field refuses it. */
export function readProvisionRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((k) => !["type", "requestId", "businessId", "farmName", "link"].includes(k))) return null;
  const { type, requestId, businessId, farmName, link } = body;
  if (type !== "PROVISION_FARM" || typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return null;
  if (typeof businessId !== "string" || !UUID.test(businessId)) return null;
  if (typeof farmName !== "string" || !farmName.trim() || farmName.length > 120) return null;
  if (!link || typeof link !== "object" || Object.keys(link).some((k) => !["keyId", "secret"].includes(k))) return null;
  if (typeof link.keyId !== "string" || !KEY_ID.test(link.keyId) || typeof link.secret !== "string" || link.secret.length < 32 || link.secret.length > 200) return null;
  return { requestId, businessId, farmId: farmIdForBusiness(businessId), farmName: farmName.trim(), link: { keyId: link.keyId, secret: link.secret } };
}

// ── Sign in with Oriya ───────────────────────────────────────────────────────────────────────────────────────────

/** A new sign-in attempt: random state, PKCE verifier and its S256 challenge. */
export function newSignIn() {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

/** The short-lived sign-in cookie: state and verifier, signed with AUTH_SECRET so it cannot be made up. */
export function sealSignIn(secret, value, nowMs = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ s: value.state, v: value.verifier, e: nowMs + 10 * 60_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`oriya-sso:${payload}`).digest("base64url")}`;
}

export function openSignIn(secret, cookie, nowMs = Date.now()) {
  const [payload, mac] = String(cookie ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(`oriya-sso:${payload}`).digest("base64url"));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value.s !== "string" || typeof value.v !== "string" || !Number.isFinite(value.e) || value.e < nowMs) return null;
    return { state: value.s, verifier: value.v };
  } catch { return null; }
}

export function sameState(a, b) {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

const ROLES = { OWNER: "OWNER", MANAGER: "MANAGER", WORKER: "WORKER", VIEWER: "READ_ONLY" };

/** Oriya's answer about who signed in, strictly. The farm must be the one Oriya set up for that business. */
export function readIdentity(json) {
  if (!json || typeof json !== "object") return null;
  const { oriyaUserId, name, role, businessId, businessName, farmId } = json;
  if (typeof oriyaUserId !== "string" || !UUID.test(oriyaUserId)) return null;
  if (typeof businessId !== "string" || !UUID.test(businessId) || farmId !== farmIdForBusiness(businessId)) return null;
  if (typeof name !== "string" || name.length > 120 || typeof businessName !== "string" || businessName.length > 120) return null;
  const mapped = ROLES[role];
  if (!mapped) return null;
  return { oriyaUserId, name: name.trim() || "Farm member", role: mapped, businessId, businessName, farmId };
}

/** The placeholder sign-in address of an Oriya person in one farm: never a real address, never their email. */
export function oriyaUserEmail(oriyaUserId, farmId) {
  return `${oriyaUserId}.${farmId}@oriya.invalid`;
}
