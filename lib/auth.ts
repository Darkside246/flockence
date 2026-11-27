import { Prisma } from "@prisma/client";
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
const SESSION_FORMAT = /^[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{43}$/;

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
function signingPayload(userId: string, farmId: string, expiresAt: number, nonce: string) {
  return Buffer.from(JSON.stringify({ userId, farmId, expiresAt, nonce })).toString("base64url");
}
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
function signedSessionToken(userId: string, farmId: string, expiresAt: number) {
  const payload = signingPayload(userId, farmId, expiresAt, randomBytes(16).toString("base64url"));
  return `${payload}.${sign(payload)}`;
}
function isProduction() { return process.env.NODE_ENV === "production"; }

function secureCookieOptions(maxAge: number) {
  if (isProduction() && process.env.AUTH_COOKIE_SECURE !== "true") throw new Error("AUTH_COOKIE_SECURE must be true in production.");
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProduction() ? "; Secure" : ""}`;
}

/** maxAgeSeconds: shorter for Oriya sign-ins, so a removal or downgrade in Oriya takes effect within hours. */
export async function createSession(userId: string, maxAgeSeconds = SESSION_DAYS * 86400, client: Prisma.TransactionClient = prisma) {
  await ensureFarm();
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  const farmId = currentFarmId();
  const token = signedSessionToken(userId, farmId, expiresAt.getTime());
  await client.setting.create({ data: { farmId, key: sessionKey(token), value: JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }) } });
  return { token, expiresAt };
}

/** Signs out: the session row is found by its own hash, whichever farm it belongs to. */
export async function destroySession(token: string) {
  const session = await sessionFromToken(token);
  if (!session) return;
  await runAsFarm(session.farmId, () => prisma.setting.deleteMany({ where: { key: sessionKey(token) } }));
}

/**
 * The person and farm a session belongs to, or null. Only the signed token is trusted: its signature, expiry and the
 * stored session row (kept under the person's own farm) must all match. Looked up outside any farm, because this is
 * how the request learns its farm.
 */
export async function sessionFromToken(token: string): Promise<{ userId: string; farmId: string } | null> {
  if (!SESSION_FORMAT.test(token)) return null;
  const [encoded, signature] = token.split(".");
  try {
    const expected = Buffer.from(sign(encoded));
    if (!timingSafeEqual(expected, Buffer.from(signature))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof payload?.userId !== "string" || !payload.userId || typeof payload.nonce !== "string" ||
        !payload.nonce || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now() ||
        (payload.farmId !== undefined && typeof payload.farmId !== "string")) return null;

    // Older signed sessions did not include the farm. Resolve it through the
    // user's existing session row while new tokens must match their signed farm.
    const user = await runUnscoped(() => prisma.user.findUnique({ where: { id: payload.userId }, select: { farmId: true } }));
    if (!user || (payload.farmId !== undefined && payload.farmId !== user.farmId)) return null;
    return await runAsFarm(user.farmId, async () => {
      const row = await prisma.setting.findUnique({
        where: { farmId_key: { farmId: user.farmId, key: sessionKey(token) } }, select: { value: true },
      });
      const saved = row ? readSessionRow(row.value) : null;
      if (!saved || saved.userId !== payload.userId || saved.expiresAt !== payload.expiresAt) return null;
      return { userId: payload.userId, farmId: user.farmId };
    });
  } catch { return null; }
}

function sessionKey(token: string) { return SESSION_PREFIX + digest(token); }

export function sessionCookieFromRequest(request: Request) {
  const cookie = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + "="));
  if (!cookie) return null;
  try {
    const token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
    return SESSION_FORMAT.test(token) ? token : null;
  } catch { return null; }
}

function readSessionRow(value: string) {
  try {
    const record = JSON.parse(value);
    if (typeof record?.userId !== "string" || typeof record.expiresAt !== "string") return null;
    const expiresAt = Date.parse(record.expiresAt);
    return Number.isFinite(expiresAt) ? { userId: record.userId, expiresAt } : null;
  } catch { return null; }
}

function userSessionPrefix(userId: string) { return '{"userId":' + JSON.stringify(userId) + ','; }

function userSessionFilter(userId: string) {
  // All issued sessions have the account id as the first field.
  return {
    farmId: currentFarmId(),
    key: { startsWith: SESSION_PREFIX },
    value: { startsWith: userSessionPrefix(userId) },
  };
}

export async function activeAccountSessions(userId: string, token: string) {
  const filter = userSessionFilter(userId);
  const current = sessionKey(token);
  const [rows, currentRow] = await Promise.all([
    prisma.setting.findMany({
      where: { ...filter, key: { ...filter.key, not: current } },
      select: { id: true, value: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50,
    }),
    prisma.setting.findFirst({
      where: { ...filter, key: current }, select: { id: true, value: true, updatedAt: true },
    }),
  ]);
  return [currentRow, ...rows].flatMap((row, index) => {
    if (!row) return [];
    const saved = readSessionRow(row.value);
    if (!saved || saved.userId !== userId || saved.expiresAt <= Date.now()) return [];
    return [{ id: row.id, current: index === 0, signedInAt: row.updatedAt.toISOString(), expiresAt: new Date(saved.expiresAt).toISOString() }];
  });
}

export async function revokeOtherAccountSessions(userId: string, token: string, id?: string) {
  const prefix = userSessionPrefix(userId);
  // Match literal prefixes as text, including ids from older installations.
  return prisma.$executeRaw`
    DELETE FROM "Setting"
    WHERE "farmId" = ${currentFarmId()}
      AND left("key", ${SESSION_PREFIX.length}::int) = ${SESSION_PREFIX}
      AND left("value", char_length(${prefix}::text)) = ${prefix}
      AND "key" <> ${sessionKey(token)}
      ${id ? Prisma.sql`AND "id" = ${id}` : Prisma.empty}
  `;
}

export function setSessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 86400) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${secureCookieOptions(maxAgeSeconds)}`; }
/** Oriya sign-ins last 8 hours, then renew through Oriya (which checks membership and plan again). */
export const ORIYA_SESSION_SECONDS = 8 * 3600;
export function clearSessionCookie() { return `${SESSION_COOKIE}=; ${secureCookieOptions(0)}`; }

export async function savePasswordHash(userId: string, passwordHash: string, client: Prisma.TransactionClient = prisma) {
  await ensureFarm();
  await client.setting.upsert({ where: { farmId_key: { farmId: currentFarmId(), key: `${PASSWORD_PREFIX}${userId}` } }, update: { value: passwordHash }, create: { farmId: currentFarmId(), key: `${PASSWORD_PREFIX}${userId}`, value: passwordHash } });
}

export async function getPasswordHash(userId: string, client: Prisma.TransactionClient = prisma) {
  const row = await client.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: `${PASSWORD_PREFIX}${userId}` } } });
  return row?.value ?? null;
}

export async function createPasswordReset(userId: string) {
  await ensureFarm();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60000);
  await prisma.setting.create({ data: { farmId: currentFarmId(), key: `${RESET_PREFIX}${digest(token)}`, value: JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }) } });
  return { token, expiresAt };
}

/** Password writes and local login session creation serialize for the account. */
export async function lockPasswordAccount(client: Prisma.TransactionClient, userId: string) {
  const lock = JSON.stringify(["local-password", currentFarmId(), userId]);
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
}

async function revokePasswordArtifacts(userId: string, client: Prisma.TransactionClient) {
  const farmId = currentFarmId();
  const rows = await client.setting.findMany({
    where: { farmId, OR: [{ key: { startsWith: SESSION_PREFIX } }, { key: { startsWith: RESET_PREFIX } }] },
    select: { id: true, value: true },
  });
  const ids = rows.filter(row => {
    try { return JSON.parse(row.value).userId === userId; } catch { return false; }
  }).map(row => row.id);
  if (ids.length) await client.setting.deleteMany({ where: { farmId, id: { in: ids } } });
}

async function replacePassword(userId: string, derived: string, client: Prisma.TransactionClient) {
  await savePasswordHash(userId, derived, client);
  await revokePasswordArtifacts(userId, client);
}

export async function changeAccountPassword(userId: string, current: string, next: string) {
  await ensureFarm();
  const existing = await getPasswordHash(userId);
  if (!existing) return "no-password";
  if (!await verifyPassword(current, existing)) return "incorrect";
  const derived = await hashPassword(next);
  return prisma.$transaction(async tx => {
    await lockPasswordAccount(tx, userId);
    if (await getPasswordHash(userId, tx) !== existing) return "incorrect";
    await replacePassword(userId, derived, tx);
    return "changed";
  });
}

export async function resetAccountPassword(token: string, next: string) {
  const key = RESET_PREFIX + digest(token);
  const found = await runUnscoped(() => prisma.setting.findFirst({ where: { key }, select: { farmId: true, value: true } }));
  if (!found) return false;
  let proof: { userId?: unknown; expiresAt?: unknown };
  try { proof = JSON.parse(found.value); } catch { return false; }
  const { userId, expiresAt } = proof ?? {};
  if (typeof userId !== "string" || typeof expiresAt !== "string" || !(Date.parse(expiresAt) > Date.now())) return false;
  const derived = await hashPassword(next);
  return runAsFarm(found.farmId, async () => {
    await ensureFarm();
    return prisma.$transaction(async tx => {
      await lockPasswordAccount(tx, userId);
      const entry = await tx.setting.findUnique({ where: { farmId_key: { farmId: found.farmId, key } } });
      if (!entry || entry.value !== found.value || !(Date.parse(expiresAt) > Date.now())) return false;
      const user = await tx.user.findFirst({ where: { id: userId, farmId: found.farmId }, select: { id: true } });
      if (!user) return false;
      await replacePassword(user.id, derived, tx);
      return true;
    });
  });
}
