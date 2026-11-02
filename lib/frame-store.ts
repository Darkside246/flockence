import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OriyaFrame } from "@/lib/oriya-link.mjs";

/**
 * The last Live View picture of each camera, kept so the next check can send it to Oriya as the earlier picture
 * (a bird lying in the same place and position in both is what separates a dead bird from a resting one).
 *
 * Kept on the farm side only, one file per camera, encrypted with AES-256-GCM under a key derived from AUTH_SECRET
 * (never stored next to the files). The file name is a hash of the camera code, so not even the code is on disk in
 * the clear. Folder 0700, files 0600. Only Live View pictures are kept: a Blink thumbnail can be hours old, which
 * would make every resting bird look "not moved".
 */

const DIR = path.join(process.cwd(), "storage", "oriya-frames");
const VERSION = 1;

function key(): Buffer | null {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("flockence-oriya-frames"), Buffer.from("reference-frame-v1"), 32));
}

const fileFor = (camera: string) => path.join(DIR, `${createHash("sha256").update(`camera:${camera}`).digest("hex").slice(0, 32)}.bin`);

export interface SavedFrame { savedAt: Date; frame: Pick<OriyaFrame, "mimeType" | "imageBase64"> }

export async function saveReferenceFrame(camera: string, frame: OriyaFrame, savedAt = new Date()): Promise<boolean> {
  const k = key();
  if (!k) return false;
  try {
    await mkdir(DIR, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", k, iv);
    cipher.setAAD(Buffer.from(`camera:${camera}`));
    const plain = Buffer.from(JSON.stringify({ v: VERSION, at: savedAt.toISOString(), mimeType: frame.mimeType, imageBase64: frame.imageBase64 }));
    const sealed = Buffer.concat([Buffer.from([VERSION]), iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    plain.fill(0);
    const target = fileFor(camera);
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, sealed, { mode: 0o600 });
    await rename(temp, target);
    return true;
  } catch {
    return false;
  } finally {
    k.fill(0);
  }
}

/** The camera's saved picture, or null when there is none, it was tampered with, or the key changed. */
export async function loadReferenceFrame(camera: string): Promise<SavedFrame | null> {
  const k = key();
  if (!k) return null;
  try {
    const sealed = await readFile(fileFor(camera));
    if (sealed.length < 1 + 12 + 16 || sealed[0] !== VERSION) return null;
    const decipher = createDecipheriv("aes-256-gcm", k, sealed.subarray(1, 13));
    decipher.setAAD(Buffer.from(`camera:${camera}`));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(13, sealed.length - 16)), decipher.final()]);
    const data = JSON.parse(plain.toString("utf8")) as { at: string; mimeType: OriyaFrame["mimeType"]; imageBase64: string };
    plain.fill(0);
    const savedAt = new Date(data.at);
    if (Number.isNaN(savedAt.getTime()) || !["image/jpeg", "image/png", "image/webp"].includes(data.mimeType)) return null;
    return { savedAt, frame: { mimeType: data.mimeType, imageBase64: data.imageBase64 } };
  } catch {
    return null;
  } finally {
    k.fill(0);
  }
}
