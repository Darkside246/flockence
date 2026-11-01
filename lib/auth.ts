import { createHash, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";

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

export async function createSession(userId: string) {
  await ensureFarm();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  const token = signedSessionToken(userId, expiresAt.getTime());
  await prisma.setting.create({ data: { farmId: FARM_ID, key: `${SESSION_PREFIX}${digest(token)}`, value: JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }) } });
  return { token, expiresAt };
}

export async function destroySession(token: string) { await ensureFarm(); await prisma.setting.deleteMany({ where: { farmId: FARM_ID, key: `${SESSION_PREFIX}${digest(token)}` } }); }

export async function userIdFromSession(token: string) {
  await ensureFarm();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const payloadText = Buffer.from(parts[0], "base64url").toString("utf8");
    const payload = JSON.parse(payloadText) as { userId: string; expiresAt: number; nonce: string };
    const expectedSig = Buffer.from(sign(parts[0]), "base64url");
    const suppliedSig = Buffer.from(parts[1], "base64url");
    if (expectedSig.length !== suppliedSig.length || !timingSafeEqual(expectedSig, suppliedSig)) return null;
    if (!payload.userId || !payload.nonce || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: FARM_ID, key: `${SESSION_PREFIX}${digest(token)}` } } });
    if (!row) return null;
    return payload.userId;
  } catch { return null; }
}

export function setSessionCookie(token: string) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${secureCookieOptions(SESSION_DAYS * 86400)}`; }
export function clearSessionCookie() { return `${SESSION_COOKIE}=; ${secureCookieOptions(0)}`; }

export async function savePasswordHash(userId: string, passwordHash: string) {
  await ensureFarm();
  await prisma.setting.upsert({ where: { farmId_key: { farmId: FARM_ID, key: `${PASSWORD_PREFIX}${userId}` } }, update: { value: passwordHash }, create: { farmId: FARM_ID, key: `${PASSWORD_PREFIX}${userId}`, value: passwordHash } });
}

export async function getPasswordHash(userId: string) {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: FARM_ID, key: `${PASSWORD_PREFIX}${userId}` } } });
  return row?.value ?? null;
}

export async function createPasswordReset(userId: string) {
  await ensureFarm();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60000);
  await prisma.setting.create({ data: { farmId: FARM_ID, key: `${RESET_PREFIX}${digest(token)}`, value: JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }) } });
  return { token, expiresAt };
}

export async function consumePasswordReset(token: string) {
  await ensureFarm();
  if (!token) return null;
  const key = `${RESET_PREFIX}${digest(token)}`;
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: FARM_ID, key } } });
  if (!row) return null;
  let value: { userId: string; expiresAt: string };
  try {
    value = JSON.parse(row.value) as { userId: string; expiresAt: string };
  } catch {
    await prisma.setting.deleteMany({ where: { id: row.id, farmId: FARM_ID } });
    return null;
  }
  if (!value.userId || !Number.isFinite(new Date(value.expiresAt).getTime()) || new Date(value.expiresAt).getTime() <= Date.now()) {
    await prisma.setting.deleteMany({ where: { id: row.id, farmId: FARM_ID } });
    return null;
  }

  // Atomically consume the single-use token. Concurrent requests cannot both reset the password.
  const consumed = await prisma.setting.deleteMany({
    where: { id: row.id, farmId: FARM_ID, key, value: row.value },
  });
  if (consumed.count !== 1) return null;
  return { userId: value.userId, settingId: row.id };
}

export async function invalidateUserSessions(userId: string) {
  await ensureFarm();
  const rows = await prisma.setting.findMany({ where: { farmId: FARM_ID, key: { startsWith: SESSION_PREFIX } } });
  await Promise.all(rows.filter((row) => { try { return JSON.parse(row.value).userId === userId; } catch { return false; } }).map((row) => prisma.setting.delete({ where: { id: row.id } })));
}
