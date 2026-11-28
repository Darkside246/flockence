import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { currentFarmId, DEFAULT_FARM_ID, runAsFarm, runUnscoped } from "@/lib/farm-scope";
import { canDeleteFarm, deletionStatus, newDeletion, parseDeletion, type FarmDeletion } from "@/lib/farm-deletion-rules.mjs";

/**
 * Self-service farm deletion with a 30-day grace period (lib/farm-deletion-rules.mjs). The request is a farm Setting
 * row, so cancelling is just removing it. While it is pending only the owner can sign in (lib/current-user.ts). When it
 * is due, the automatic round deletes the farm: pictures, then the rows the database would refuse to cascade through,
 * then the farm itself, whose relations remove everything else.
 */
export const DELETION_KEY = "FARM_DELETION_V1";

export async function loadFarmDeletion(farmId = currentFarmId()): Promise<FarmDeletion | null> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId, key: DELETION_KEY } }, select: { value: true } });
  return parseDeletion(row?.value);
}

/** Cheap check used on every signed-in request: is this farm locked for deletion? */
export async function farmLockedForDeletion(farmId: string) {
  return Boolean(await loadFarmDeletion(farmId).catch(() => null));
}

export async function requestFarmDeletion(userId: string, now = new Date()) {
  const farmId = currentFarmId();
  if (!canDeleteFarm(farmId, DEFAULT_FARM_ID)) throw new Error("HOME_FARM");
  const existing = await loadFarmDeletion(farmId);
  if (existing) return existing;
  const deletion = newDeletion(now, userId);
  const value = JSON.stringify(deletion);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: DELETION_KEY } }, create: { farmId, key: DELETION_KEY, value }, update: { value } });
  // From now on every signed-in request from anyone but the owner is refused (lib/current-user.ts).
  return deletion;
}

export async function cancelFarmDeletion() {
  await prisma.setting.deleteMany({ where: { farmId: currentFarmId(), key: DELETION_KEY } });
}

export async function farmDeletionState(now = new Date()) {
  return deletionStatus(await loadFarmDeletion(), now);
}

const safeKey = /^[A-Za-z0-9_-]+\.(jpg|png|webp|gif)$/;

/** Delete the current farm now. Only called for a due request; never for the home farm. */
export async function deleteFarmNow(storageDir: string) {
  const farmId = currentFarmId();
  if (!canDeleteFarm(farmId, DEFAULT_FARM_ID)) throw new Error("HOME_FARM");
  const media = await prisma.visionMedia.findMany({ where: { farmId }, select: { storageKey: true } });
  await prisma.$transaction(async (tx) => {
    // Rows held by a RESTRICT relation (packed eggs -> stock lots -> products) go first, and the two purchase tables that
    // carry a farm id without a database relation, so the farm delete below can cascade through everything else.
    await tx.eggPackInput.deleteMany({});
    await tx.inventoryItem.deleteMany({});
    await tx.feedPurchase.deleteMany({});
    await tx.beddingPurchase.deleteMany({});
    await tx.farm.delete({ where: { id: farmId } });
  }, { timeout: 120_000 });
  // Pictures only once the records are gone, so a failed delete never leaves records without their pictures.
  for (const { storageKey } of media) if (safeKey.test(storageKey)) await unlink(path.join(storageDir, storageKey)).catch(() => undefined);
  return { farmId, pictures: media.length };
}

/** Every farm whose grace period is over. One farm's failure never stops the others; it is tried again next round. */
export async function runDueFarmDeletions(storageDir: string, now = new Date()) {
  const pending = await runUnscoped(() => prisma.setting.findMany({ where: { key: DELETION_KEY }, select: { farmId: true, value: true } }));
  type Result = { farmId: string; deleted: boolean; error?: string };
  const results: Result[] = [];
  for (const row of pending) {
    if (!canDeleteFarm(row.farmId, DEFAULT_FARM_ID)) continue;
    const status = deletionStatus(parseDeletion(row.value), now);
    if (!status.pending || !status.due) continue;
    const r: Result = await runAsFarm(row.farmId, () => deleteFarmNow(storageDir))
      .then((): Result => ({ farmId: row.farmId, deleted: true }))
      .catch((error): Result => ({ farmId: row.farmId, deleted: false, error: error instanceof Error ? error.message.slice(0, 120) : "unknown" }));
    if (!r.deleted) console.warn(`[farm-deletion] could not delete farm ${row.farmId}: ${r.error}`);
    results.push(r);
  }
  return results;
}
