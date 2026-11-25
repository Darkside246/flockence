import { randomUUID } from "node:crypto";
import { createSession, hashPassword, normalizeEmail, validatePassword } from "@/lib/auth";
import { runAsFarm } from "@/lib/farm-scope";
import { prisma } from "@/lib/prisma";

type VerifiedRegistration = {
  verifiedEmail: string;
  ownerName: string;
  farmName: string;
  password: string;
};

/** Called only after the registration flow proves possession of verifiedEmail. */
export async function provisionFreeFarm(registration: VerifiedRegistration) {
  const email = normalizeEmail(registration.verifiedEmail);
  const name = registration.ownerName.trim();
  const farmName = registration.farmName.trim();
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)
    || name.length < 2 || name.length > 120 || farmName.length < 2 || farmName.length > 120
    || registration.password.length > 128 || !validatePassword(registration.password).valid) {
    throw new Error("INVALID_FREE_REGISTRATION");
  }

  const farmId = "free-" + randomUUID();
  const passwordHash = await hashPassword(registration.password);

  return runAsFarm(farmId, () => prisma.$transaction(async (tx) => {
    await tx.farm.create({ data: { id: farmId, name: farmName } });
    const owner = await tx.user.create({
      data: { farmId, name, email, role: "OWNER" },
      select: { id: true, farmId: true, role: true },
    });
    await tx.setting.createMany({
      data: [
        { farmId, key: "MEMBERSHIP_V1", value: "FREE" },
        { farmId, key: "STORAGE_BYTES_USED_V1", value: "0" },
        { farmId, key: "AI_USAGE_V1", value: JSON.stringify({ period: new Date().toISOString().slice(0, 7), used: 0 }) },
        { farmId, key: "AUTH_PASSWORD::" + owner.id, value: passwordHash },
      ],
    });
    const session = await createSession(owner.id, undefined, tx);
    return { owner, session };
  }));
}
