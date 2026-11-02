import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FARM_ID, currentFarmId } from "@/lib/farm-scope";
import { oriyaLinkConfig, type OriyaLinkConfig } from "@/lib/oriya-link.mjs";

/**
 * Each farm's own link to Oriya (one account for Oriya and Flockence, 2026-11-02). A farm set up by Oriya receives its
 * link key id and secret in the signed setup call; they are kept in that farm's settings, encrypted (AES-256-GCM, key
 * derived from AUTH_SECRET, the farm id bound in), and never shown. The PC's single farm can still use ORIYA_LINK_* in
 * .env. The platform secret (ORIYA_PLATFORM_SECRET, the same as Oriya's FLOCKENCE_PLATFORM_SECRET) signs setup and
 * sign-in between the two servers.
 */

const LINK_KEY = "ORIYA_LINK";

export function platformSecret(): string | null {
  const value = String(process.env.ORIYA_PLATFORM_SECRET ?? "");
  return value.length >= 32 ? value : null;
}

/** Oriya's address for this install (HTTPS on oriya.si). */
export function oriyaBaseUrl(): string | null {
  return oriyaLinkConfig({ ...process.env, ORIYA_LINK_KEY_ID: `cop_${"x".repeat(24)}`, ORIYA_LINK_SECRET: "x".repeat(32) })?.baseUrl ?? null;
}

function key(farmId: string): Buffer | null {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("flockence-oriya-link"), Buffer.from(`farm:${farmId}`), 32));
}

export async function saveFarmLink(link: { keyId: string; secret: string }): Promise<boolean> {
  const farmId = currentFarmId();
  const k = key(farmId);
  if (!k) return false;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(`oriya-link:${farmId}`));
  const sealed = Buffer.concat([iv, cipher.update(JSON.stringify(link), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  k.fill(0);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: LINK_KEY } }, create: { farmId, key: LINK_KEY, value: `v1:${sealed}` }, update: { value: `v1:${sealed}` } });
  return true;
}

/** This farm's link to Oriya: its own (set up by Oriya), or for the PC's own farm the one in .env. */
export async function farmLinkConfig(): Promise<OriyaLinkConfig | null> {
  const farmId = currentFarmId();
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId, key: LINK_KEY } }, select: { value: true } });
  if (row?.value.startsWith("v1:")) {
    const k = key(farmId);
    if (!k) return null;
    try {
      const raw = Buffer.from(row.value.slice(3), "base64");
      const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(`oriya-link:${farmId}`));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      const link = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8")) as { keyId: string; secret: string };
      return oriyaLinkConfig({ ...process.env, ORIYA_LINK_KEY_ID: link.keyId, ORIYA_LINK_SECRET: link.secret });
    } catch {
      return null;
    } finally {
      k.fill(0);
    }
  }
  return farmId === DEFAULT_FARM_ID ? oriyaLinkConfig(process.env) : null;
}
