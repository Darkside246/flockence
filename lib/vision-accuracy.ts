import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import { LABEL_PREFIX, accuracyReport, cleanLabel, modelSaid, parseSavedLabel, type VisionLabel } from "@/lib/vision-accuracy-rules.mjs";

/** Recent Farm Vision checks with what the model said and the farmer's label, and the measured accuracy. */
export async function visionAccuracy(days = 60, now = new Date()) {
  const farmId = currentFarmId();
  const since = new Date(now.getTime() - days * 86_400_000);
  const checks = await prisma.healthObservation.findMany({
    where: { farmId, category: { startsWith: "VISION:" }, observedAt: { gte: since }, imageUrl: { not: null } },
    select: { id: true, observedAt: true, imageUrl: true, notes: true, visionAssessment: true },
    orderBy: { observedAt: "desc" }, take: 300,
  });
  const [labels, findings] = await Promise.all([
    prisma.setting.findMany({ where: { farmId, key: { in: checks.map((c) => LABEL_PREFIX + c.id) } }, select: { key: true, value: true } }),
    prisma.visionFinding.groupBy({ by: ["state"], where: { farmId, kind: "DEAD_OR_DOWN_BIRD", state: { in: ["CONFIRMED", "DISMISSED", "RESOLVED"] }, lastSeenAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const byId = new Map(labels.map((l) => [l.key.slice(LABEL_PREFIX.length), parseSavedLabel(l.value)]));
  const rows = checks.map((c) => {
    const a = (c.visionAssessment ?? {}) as { source?: { kind?: string; name?: string }; pen?: { name?: string } };
    return {
      id: c.id, observedAt: c.observedAt.toISOString(), imageUrl: c.imageUrl,
      camera: a.source?.kind === "CAMERA" ? a.source.name ?? null : null, pen: a.pen?.name ?? null,
      said: modelSaid(c.visionAssessment, c.notes), label: byId.get(c.id) ?? null,
    };
  });
  const count = (state: string) => findings.find((f) => f.state === state)?._count._all ?? 0;
  // A resolved dead-bird finding was real (someone dealt with it); a dismissed one was a false alarm.
  const report = accuracyReport(rows, { confirmed: count("CONFIRMED") + count("RESOLVED"), dismissed: count("DISMISSED") });
  return { rows, report };
}

/** Save or clear one check's label. False when the check is not a Farm Vision check of this farm. */
export async function saveVisionLabel(observationId: string, input: unknown, userId: string) {
  const farmId = currentFarmId();
  const check = await prisma.healthObservation.findFirst({ where: { id: observationId, farmId, category: { startsWith: "VISION:" } }, select: { id: true } });
  if (!check) return false;
  const label: VisionLabel | null | undefined = cleanLabel(input);
  if (label === undefined) throw new Error("BAD_LABEL");
  const key = LABEL_PREFIX + observationId;
  if (label === null) { await prisma.setting.deleteMany({ where: { farmId, key } }); return true; }
  const value = JSON.stringify({ ...label, by: userId, at: new Date().toISOString() });
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
  return true;
}
