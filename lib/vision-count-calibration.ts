import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import type { CountSample } from "@/lib/vision-glance-rules.mjs";

/**
 * Each camera's real counts (lib/vision-glance-rules.mjs cameraFactor): when someone enters the actual number of birds
 * in the pen for a Vision check, the pair (Vision's count, the real count) is kept for that camera, the last 10. From
 * 2 pairs on, that camera's counts are scaled to the pen. The farm's records are never changed.
 */
const key = (camera: string) => `VISION_COUNT_SAMPLES::${camera}`.slice(0, 190);

export async function countSamples(camera: string): Promise<CountSample[]> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: key(camera) } }, select: { value: true } });
  try { const v = JSON.parse(row?.value ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function addCountSample(camera: string, sample: CountSample & { observationId: string }) {
  const farmId = currentFarmId();
  const k = key(camera);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId + ":" + k}, 0))::text`;
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: k } }, select: { value: true } });
    let list: (CountSample & { observationId?: string })[] = [];
    try { const v = JSON.parse(row?.value ?? "[]"); if (Array.isArray(v)) list = v; } catch { /* start again */ }
    // One real count per inspection: a correction replaces the earlier one.
    list = [...list.filter((s) => s.observationId !== sample.observationId), sample].slice(-10);
    const value = JSON.stringify(list);
    await tx.setting.upsert({ where: { farmId_key: { farmId, key: k } }, create: { farmId, key: k, value }, update: { value } });
    return list;
  });
}
