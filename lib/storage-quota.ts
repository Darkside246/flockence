import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import { currentVisionPlan } from "@/lib/vision-plan";
import { bytesToFree, formatBytes, PRUNE_MIN_AGE_DAYS, storageLimitBytes, storageStatus, type StorageStatus } from "@/lib/storage-quota-rules.mjs";

/** Farm Vision pictures this farm keeps on the server, in bytes (lib/storage-quota-rules.mjs has the limits). */
export async function farmStorageUsed(): Promise<number> {
  const sum = await prisma.visionMedia.aggregate({ where: { farmId: currentFarmId() }, _sum: { byteSize: true } });
  return sum._sum.byteSize ?? 0;
}

export async function farmStorage(): Promise<StorageStatus & { plan: string; label: string }> {
  const [{ plan, label }, used] = await Promise.all([currentVisionPlan(), farmStorageUsed()]);
  return { ...storageStatus(used, storageLimitBytes(plan, process.env.STORAGE_PLAN_LIMITS_GB ?? "")), plan, label };
}

const safeKey = /^[A-Za-z0-9_-]+\.(jpg|png|webp|gif)$/;

/** Remove the oldest pictures older than PRUNE_MIN_AGE_DAYS until `bytes` are freed. The written results stay. */
async function pruneOldestPictures(bytes: number, storageDir: string, now: Date) {
  const cutoff = new Date(now.getTime() - PRUNE_MIN_AGE_DAYS * 86_400_000);
  let freed = 0;
  while (freed < bytes) {
    const batch = await prisma.visionMedia.findMany({
      where: { farmId: currentFarmId(), createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true, byteSize: true }, orderBy: { createdAt: "asc" }, take: 50,
    });
    if (!batch.length) break;
    for (const media of batch) {
      if (freed >= bytes) break;
      await prisma.$transaction(async (tx) => {
        await tx.healthObservation.updateMany({ where: { farmId: currentFarmId(), visionMediaId: media.id }, data: { imageUrl: null } });
        await tx.visionMedia.delete({ where: { id: media.id } });
      });
      if (safeKey.test(media.storageKey)) await unlink(path.join(storageDir, media.storageKey)).catch(() => undefined);
      freed += media.byteSize;
    }
  }
  return freed;
}

/**
 * Make room for one more picture of `extraBytes`, before the paid vision call. Prunes old pictures if needed; refuses
 * with a plain message when the farm is still full.
 */
export async function ensureStorageRoom(extraBytes: number, storageDir: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await farmStorage();
  const needed = bytesToFree(status.used, extraBytes, status.limit);
  if (!needed) return { ok: true };
  const freed = await pruneOldestPictures(needed, storageDir, now);
  if (freed >= needed) return { ok: true };
  return { ok: false, error: `Farm Vision storage is full (${formatBytes(status.used - freed)} of ${formatBytes(status.limit)} on the ${status.label} plan). Pictures are only removed automatically once they are ${PRUNE_MIN_AGE_DAYS} days old. Upgrade the plan under Settings > Devices & plan.` };
}
