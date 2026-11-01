import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const backupConfirmed = args.has("--confirm-backup");
const publicPrefix = "/uploads/vision/";
const mimeByExtension = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

function loadLocalEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[match[1]] = value;
  }
}

async function loadDotEnv() {
  for (const filename of [".env", ".env.local"]) {
    try { loadLocalEnv(await readFile(path.resolve(process.cwd(), filename), "utf8")); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function sourceName(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith(publicPrefix)) return null;
  const encoded = imageUrl.slice(publicPrefix.length).split(/[?#]/, 1)[0];
  let decoded;
  try { decoded = decodeURIComponent(encoded); } catch { return null; }
  if (!decoded || decoded !== path.basename(decoded) || decoded.includes("..") || decoded.includes("\\") || decoded.includes("/")) return null;
  return decoded;
}

async function main() {
  await loadDotEnv();
  const farmId = process.env.FARM_ID || "default-farm";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Set it in the environment or .env before running this script.");
  if (apply && !backupConfirmed) {
    throw new Error("Refusing to change records without --confirm-backup. Take and verify a database and file backup first.");
  }

  const prisma = new PrismaClient();
  const publicRoot = path.resolve(process.cwd(), "public", "uploads", "vision");
  const storageRoot = path.resolve(process.env.VISION_STORAGE_DIR || path.join(process.cwd(), "storage", "vision"));
  let moved = 0;
  let skipped = 0;
  let failures = 0;

  try {
    const rows = await prisma.healthObservation.findMany({
      where: {
        farmId,
        visionMediaId: null,
        imageUrl: { startsWith: publicPrefix },
      },
      select: { id: true, imageUrl: true },
      orderBy: { createdAt: "asc" },
    });

    const grouped = new Map();
    for (const row of rows) {
      if (!row.imageUrl) continue;
      const group = grouped.get(row.imageUrl) || [];
      group.push(row.id);
      grouped.set(row.imageUrl, group);
    }

    console.log(`Farm: ${farmId}`);
    console.log(`Legacy public media references: ${rows.length}`);
    console.log(`Unique source files: ${grouped.size}`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Private storage: ${storageRoot}`);

    if (!apply) {
      for (const [imageUrl, observationIds] of grouped) {
        const name = sourceName(imageUrl);
        if (!name) { console.log(`SKIP unsafe URL: ${imageUrl}`); skipped += observationIds.length; continue; }
        const source = path.resolve(publicRoot, name);
        if (!source.startsWith(publicRoot + path.sep)) { console.log(`SKIP path escape: ${imageUrl}`); skipped += observationIds.length; continue; }
        try {
          const info = await lstat(source);
          if (!info.isFile() || info.isSymbolicLink()) throw new Error("source is not a regular file");
          const mimeType = mimeByExtension.get(path.extname(name).toLowerCase());
          if (!mimeType) throw new Error("unsupported image extension");
          console.log(`WOULD MOVE ${name} (${info.size} bytes, ${observationIds.length} observation(s))`);
        } catch (error) {
          console.log(`SKIP ${name}: ${error instanceof Error ? error.message : "source unavailable"}`);
          skipped += observationIds.length;
        }
      }
      console.log("Dry run complete. No database records or files were changed.");
      return;
    }

    await mkdir(storageRoot, { recursive: true, mode: 0o700 });
    for (const [imageUrl, observationIds] of grouped) {
      const name = sourceName(imageUrl);
      if (!name) { console.warn(`SKIP unsafe URL: ${imageUrl}`); skipped += observationIds.length; continue; }
      const source = path.resolve(publicRoot, name);
      if (!source.startsWith(publicRoot + path.sep)) { skipped += observationIds.length; continue; }

      let privatePath = null;
      let databaseCommitted = false;
      try {
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("source is not a regular file");
        const extension = path.extname(name).toLowerCase();
        const mimeType = mimeByExtension.get(extension);
        if (!mimeType) throw new Error("unsupported image extension");

        const storageKey = `${randomUUID()}${extension}`;
        privatePath = path.resolve(storageRoot, storageKey);
        if (!privatePath.startsWith(storageRoot + path.sep)) throw new Error("invalid private storage path");
        const bytes = await readFile(source);
        await writeFile(privatePath, bytes, { flag: "wx", mode: 0o600 });

        const result = await prisma.$transaction(async (tx) => {
          const media = await tx.visionMedia.create({
            data: { farmId, storageKey, mimeType, byteSize: bytes.byteLength },
          });
          const updated = await tx.healthObservation.updateMany({
            where: { farmId, imageUrl, visionMediaId: null },
            data: { visionMediaId: media.id, imageUrl: `/api/vision/media/${media.id}` },
          });
          if (updated.count === 0) throw new Error("no legacy observations remained to migrate");
          return { mediaId: media.id, updated: updated.count };
        });
        databaseCommitted = true;
        moved += result.updated;
        console.log(`MOVED ${name} -> ${result.mediaId} (${result.updated} observation(s))`);

        try {
          await unlink(source);
        } catch (error) {
          failures += observationIds.length;
          console.error(`PUBLIC COPY STILL EXISTS for ${name}: ${error instanceof Error ? error.message : "unlink failed"}. Remove it manually after verifying the private record.`);
        }
      } catch (error) {
        // Never delete a private file after its database reference has committed.
        if (!databaseCommitted && privatePath) await unlink(privatePath).catch(() => undefined);
        failures += observationIds.length;
        console.error(`FAILED ${name}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    console.log(`Migration complete. Updated observations: ${moved}. Skipped: ${skipped}. Failed: ${failures}.`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
