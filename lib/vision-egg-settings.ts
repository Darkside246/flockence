import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";

/**
 * Egg counts from pictures (Vision Intelligence phase 4). Off until the farm has compared Vision's floor and nest egg
 * counts with its own collections and switched them on; until then Vision only says that floor eggs were seen, and
 * where. Egg records are never changed by Vision either way.
 */
const KEY = "VISION_EGG_COUNTS";

export async function eggCountsOn(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: KEY } }, select: { value: true } });
  return row?.value === "on";
}

export async function setEggCounts(on: boolean) {
  const farmId = currentFarmId(), value = on ? "on" : "off";
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: KEY } }, create: { farmId, key: KEY, value }, update: { value } });
}
