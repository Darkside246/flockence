import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import {
  decryptSecret, encryptSecret, findRecoveryCode, hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUrl, verifyCode,
} from "@/lib/totp.mjs";

/**
 * Two-factor sign-in per person (Account page). One Setting row per user in their farm: the authenticator secret
 * encrypted with AUTH_SECRET, hashes of unused recovery codes, and the newest code step used (so no code works twice).
 * Only password sign-in asks for it; Oriya sign-in keeps Oriya's own checks.
 */
const keyFor = (userId: string) => "TWO_FACTOR_V1::" + userId;
type Stored = { sealed?: string; pendingSealed?: string; enabledAt?: string | null; recovery?: string[]; lastStep?: number };

async function load(userId: string, client: typeof prisma = prisma): Promise<Stored> {
  const row = await client.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: keyFor(userId) } }, select: { value: true } });
  try { return row ? JSON.parse(row.value) as Stored : {}; } catch { return {}; }
}

async function save(userId: string, value: Stored, client: typeof prisma = prisma) {
  const farmId = currentFarmId(), key = keyFor(userId), text = JSON.stringify(value);
  await client.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value: text }, update: { value: text } });
}

/** Serialize checks for one person, so two sign-ins cannot use the same code or recovery code. */
async function locked<T>(userId: string, work: (tx: typeof prisma) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"two-factor:" + userId}, 0))::text`;
    return work(tx as unknown as typeof prisma);
  });
}

export async function twoFactorStatus(userId: string) {
  const s = await load(userId);
  return { enabled: Boolean(s.sealed && s.enabledAt), recoveryLeft: s.recovery?.length ?? 0, enrolling: Boolean(s.pendingSealed) };
}

/** Step 1: a new secret for the authenticator app. Nothing changes for sign-in until it is confirmed with a code. */
export async function startTwoFactor(userId: string, email: string) {
  const secret = newSecret();
  await locked(userId, async (tx) => {
    const s = await load(userId, tx);
    await save(userId, { ...s, pendingSealed: encryptSecret(secret, process.env.AUTH_SECRET) }, tx);
  });
  return { secret, url: otpauthUrl(secret, email) };
}

/** Step 2: the first code from the app switches it on and returns the recovery codes, shown once. */
export async function confirmTwoFactor(userId: string, code: unknown, now = Date.now()) {
  return locked(userId, async (tx) => {
    const s = await load(userId, tx);
    if (!s.pendingSealed) return null;
    const secret = decryptSecret(s.pendingSealed, process.env.AUTH_SECRET);
    const step = verifyCode(secret, code, now);
    if (step === null) return null;
    const recovery = newRecoveryCodes();
    await save(userId, { sealed: s.pendingSealed, enabledAt: new Date(now).toISOString(), recovery: recovery.map(hashRecoveryCode), lastStep: step }, tx);
    return recovery;
  });
}

/** A code from the app, or one unused recovery code (which is then used up). */
export async function checkSecondFactor(userId: string, code: unknown, now = Date.now()) {
  return locked(userId, async (tx) => {
    const s = await load(userId, tx);
    if (!s.sealed || !s.enabledAt) return true;
    const step = verifyCode(decryptSecret(s.sealed, process.env.AUTH_SECRET), code, now, s.lastStep ?? -1);
    if (step !== null) { await save(userId, { ...s, lastStep: step }, tx); return true; }
    const index = findRecoveryCode(s.recovery, code);
    if (index >= 0) { await save(userId, { ...s, recovery: (s.recovery ?? []).filter((_, i) => i !== index) }, tx); return true; }
    return false;
  });
}

export async function twoFactorEnabled(userId: string) {
  return (await twoFactorStatus(userId)).enabled;
}

export async function disableTwoFactor(userId: string) {
  await prisma.setting.deleteMany({ where: { farmId: currentFarmId(), key: keyFor(userId) } });
}

export async function newRecoveryCodesFor(userId: string) {
  return locked(userId, async (tx) => {
    const s = await load(userId, tx);
    if (!s.sealed || !s.enabledAt) return null;
    const recovery = newRecoveryCodes();
    await save(userId, { ...s, recovery: recovery.map(hashRecoveryCode) }, tx);
    return recovery;
  });
}
