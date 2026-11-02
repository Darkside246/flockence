import { createHash, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { runAsFarm, runUnscoped } from "@/lib/farm-scope";

const scrypt = promisify(nodeScrypt);

export const SESSION_COOKIE = "chicken_op_session";
const SESSION_PREFIX = "AUTH_SESSION::";
const RESET_PREFIX = "AUTH_RESET::";
const PASSWORD_PREFIX = "AUTH_PASSWORD::";
const SESSION_DAYS = 30;
const RESET_MINUTES = 30;

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }

export function validatePassword(password: string) {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Use at least 8 characters.");
  if (!/[A-Z]/.test(password)) errors.push("Include at least one uppercase letter.");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Include at least one special character.");
  return { valid: errors.length === 0, errors };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function secret() { const value = process.env.AUTH_SECRET; if (!value || value.length < 32) throw new Error("AUTH_SECRET must be configured with at least 32 characters."); return value; }
function signingPayload(userId: string, expiresAt: number, nonce: string) { return Buffer.from(JSON.stringify({ userId, expiresAt, nonce })).toString("base64url"); }
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
function signedSessionToken(userId: string, expiresAt: number) { const payload = signingPayload(userId, expiresAt, randomBytes(16).toString("base64url")); return `${payload}.${sign(payload)}`; }
function isProduction() { return process.env.NODE_ENV === "production"; }

function secureCookieOptions(maxAge: number) {
  if (isProduction() && process.env.AUTH_COOKIE_SECURE !== "true") throw new Error("AUTH_COOKIE_SECURE must be true in production.");
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProduction() ? "; Secure" : ""}`;
}

/** maxAgeSeconds: shorter for Oriya sign-ins, so a removal or downgrade in Oriya takes effect within hours. */
export async function createSession(userId: string, maxAgeSeconds = SESSION_DAYS * 86400) {
  await ensureFarm();
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  const token = signedSessionToken(userId, expiresAt.getTime());
  await prisma.setting.create({ data: { farmId: currentFarmId(), key: `${SESSION_PREFIX}${digest(token)}`, value: JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }) } });
  return { token, expiresAt };
}

/** Signs out: the session row is found by its own hash, whichever farm it belongs to. */
export async function destroySession(token: string) {
  const session = await sessionFromToken(token);
  if (!session) return;
  await runAsFarm(session.farmId, () => prisma.setting.deleteMany({ where: { key: `${SESSION_PREFIX}${digest(token)}` } }));
}

/**
 * The person and farm a session belongs to, or null. Only the signed token is trusted: its signature, expiry and the
 * stored session row (kept under the person's own farm) must all match. Looked up outside any farm, because this is
 * how the request learns its farm.
 */
export async function sessionFromToken(token: string): Promise<{ userId: string; farmId: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const payloadText = Buffer.from(parts[0], "base64url").toString("utf8");
    const payload = JSON.parse(payloadText) as { userId: string; expiresAt: number; nonce: string };
    const expectedSig = Buffer.from(sign(parts[0]), "base64url");
    const suppliedSig = Buffer.from(parts[1], "base64url");
    if (expectedSig.length !== suppliedSig.length || !timingSafeEqual(expectedSig, suppliedSig)) return null;
    if (!payload.userId || !payload.nonce || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return await runUnscoped(async () => {
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { farmId: true } });
      if (!user) return null;
      const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: user.farmId, key: `${SESSION_PREFIX}${digest(token)}` } } });
      if (!row) return null;
      return { userId: payload.userId, farmId: user.farmId };
    });
  } catch { return null; }
}

export function setSessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 86400) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${secureCookieOptions(maxAgeSeconds)}`; }
/** Oriya sign-ins last 8 hours, then renew through Oriya (which checks membership and plan again). */
export const ORIYA_SESSION_SECONDS = 8 * 3600;
export function clearSessionCookie() { return `${SESSION_COOKIE}=; ${secureCookieOptions(0)}`; }

export async function savePasswordHash(userId: string, passwordHash: string) {
  await ensureFarm();
  await prisma.setting.upsert({ where: { farmId_key: { farmId: currentFarmId(), key: `${PASSWORD_PREFIX}${userId}` } }, update: { value: passwordHash }, create: { farmId: currentFarmId(), key: `${PASSWORD_PREFIX}${userId}`, value: passwordHash } });
}

export async function getPasswordHash(userId: string) {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: `${PASSWORD_PREFIX}${userId}` } } });
  return row?.value ?? null;
}

export async function createPasswordReset(userId: string) {
  await ensureFarm();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60000);
  await prisma.setting.create({ data: { farmId: currentFarmId(), key: `${RESET_PREFIX}${digest(token)}`, value: JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }) } });
  return { token, expiresAt };
}

/** The reset link's farm, found by the link's own hash; the rest runs inside that farm. */
export async function consumePasswordReset(token: string): Promise<{ userId: string; settingId: string; farmId: string } | null> {
  if (!token) return null;
  const key = `${RESET_PREFIX}${digest(token)}`;
  const found = await runUnscoped(() => prisma.setting.findFirst({ where: { key }, select: { farmId: true } }));
  if (!found) return null;
  const result = await runAsFarm(found.farmId, () => consumeInFarm(key));
  return result ? { ...result, farmId: found.farmId } : null;
}

async function consumeInFarm(key: string) {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key } } });
  if (!row) return null;
  let value: { userId: string; expiresAt: string };
  try {
    value = JSON.parse(row.value) as { userId: string; expiresAt: string };
  } catch {
    await prisma.setting.deleteMany({ where: { id: row.id, farmId: currentFarmId() } });
    return null;
  }
  if (!value.userId || !Number.isFinite(new Date(value.expiresAt).getTime()) || new Date(value.expiresAt).getTime() <= Date.now()) {
    await prisma.setting.deleteMany({ where: { id: row.id, farmId: currentFarmId() } });
    return null;
  }

  // Atomically consume the single-use token. Concurrent requests cannot both reset the password.
  const consumed = await prisma.setting.deleteMany({
    where: { id: row.id, farmId: currentFarmId(), key, value: row.value },
  });
  if (consumed.count !== 1) return null;
  return { userId: value.userId, settingId: row.id };
}

export async function invalidateUserSessions(userId: string) {
  await ensureFarm();
  const rows = await prisma.setting.findMany({ where: { farmId: currentFarmId(), key: { startsWith: SESSION_PREFIX } } });
  await Promise.all(rows.filter((row) => { try { return JSON.parse(row.value).userId === userId; } catch { return false; } }).map((row) => prisma.setting.delete({ where: { id: row.id } })));
}
