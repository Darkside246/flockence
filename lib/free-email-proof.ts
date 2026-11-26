import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FARM_ID, runAsFarm, runUnscoped } from "@/lib/farm-scope";
import { ensureFarm } from "@/lib/operations";
import { provisionFreeFarm } from "@/lib/free-registration";

const prefix = "AUTH_FREE_SIGNUP::";
const lifetime = 30 * 60 * 1000;
const proofKey = (token: string) => prefix + createHash("sha256").update(token).digest("hex");
export const freeSignupTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function issueFreeEmailProof(email: string) {
  const token = randomBytes(32).toString("base64url");
  await runAsFarm(DEFAULT_FARM_ID, async () => {
    await ensureFarm();
    const now = Date.now();
    await prisma.setting.deleteMany({ where: { key: { startsWith: prefix }, updatedAt: { lt: new Date(now - lifetime) } } });
    await prisma.setting.create({
      data: { farmId: DEFAULT_FARM_ID, key: proofKey(token), value: JSON.stringify({ email, expiresAt: now + lifetime }) },
    });
  });
  return token;
}

export function discardFreeEmailProof(token: string) {
  return runAsFarm(DEFAULT_FARM_ID, () => prisma.setting.deleteMany({ where: { key: proofKey(token) } }));
}

export function completeVerifiedFreeSignup(token: string, form: { ownerName: string; farmName: string; password: string }) {
  if (!freeSignupTokenPattern.test(token)) throw new Error("INVALID_SIGNUP_PROOF");
  // Verification consumes a proof in the default farm and creates a different farm atomically.
  // This identity transaction uses explicit farm IDs for each operation.
  return runUnscoped(() => prisma.$transaction(async (tx) => {
    const key = proofKey(token);
    const setting = await tx.setting.findUnique({ where: { farmId_key: { farmId: DEFAULT_FARM_ID, key } } });
    if (!setting) throw new Error("INVALID_SIGNUP_PROOF");
    const proof = JSON.parse(setting.value);
    if (typeof proof.email !== "string" || typeof proof.expiresAt !== "number" || proof.expiresAt <= Date.now()) {
      throw new Error("INVALID_SIGNUP_PROOF");
    }
    const consumed = await tx.setting.deleteMany({ where: { farmId: DEFAULT_FARM_ID, key, value: setting.value } });
    if (consumed.count !== 1) throw new Error("INVALID_SIGNUP_PROOF");
    const verifiedEmail: string = proof.email;
    return { ...await provisionFreeFarm({ ...form, verifiedEmail }, tx), verifiedEmail };
  }));
}
