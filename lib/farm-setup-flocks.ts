import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SetupFlock } from "@/lib/farm-setup";

export const invalidSetupPen = "SETUP_PEN_NOT_FOUND";

export function setupPenChoices(settings: { key: string; value: string }[], prefix: string) {
  return settings.flatMap(({ key, value }) => {
    if (!key.startsWith(prefix)) return [];
    const id = key.slice(prefix.length);
    if (!/^[a-f0-9-]{36}$/i.test(id)) return [];
    try {
      const pen = JSON.parse(value);
      return typeof pen?.name === "string" && pen.name.trim() ? [{ id, name: pen.name }] : [];
    } catch {
      return [];
    }
  });
}

/** The caller holds the farm lock and creates any new pens before this runs. */
export async function createSetupFlocks(
  tx: Prisma.TransactionClient, farmId: string, userId: string, flocks: SetupFlock[],
) {
  if (!flocks.length) return;
  const prefix = "PEN::" + userId + "::";
  const selected = [...new Set(flocks.map((flock) => flock.penId).filter(Boolean))];
  const settings = selected.length
    ? await tx.setting.findMany({ where: { key: { in: selected.map((id) => prefix + id) } }, select: { key: true, value: true } })
    : [];
  const penNames = new Map(setupPenChoices(settings, prefix).map(({ id, name }) => [id, name]));
  const recordedAt = new Date();
  for (const flock of flocks) {
    const id = "setup-" + createHash("sha256").update(farmId + ":" + flock.id).digest("hex").slice(0, 32);
    if (await tx.batch.findUnique({ where: { id }, select: { id: true } })) continue;
    const pen = flock.penId ? penNames.get(flock.penId) : undefined;
    if (flock.penId && !pen) throw new Error(invalidSetupPen);
    const placementDate = flock.placementDate ? new Date(flock.placementDate + "T00:00:00.000Z") : null;
    const layerStage = flock.productionType === "LAYER" ? flock.layerStage : null;
    const placementNotes = [
      pen ? "Initial pen: " + pen : "",
      flock.approximateAgeWeeks === null ? "" : "Approximate age at setup: " + flock.approximateAgeWeeks + " weeks",
    ].filter(Boolean).join(". ");
    // These nested rows reference only the batch being created, in the same database write.
    await tx.batch.create({ data: {
      id, farmId, name: flock.name, species: "CHICKEN",
      productionType: flock.productionType, layerStage, breed: flock.breed || null,
      startDate: placementDate ?? recordedAt, purchaseDate: placementDate,
      lifecycleDateSource: placementDate ? "PURCHASE_DATE_ESTIMATE" : "START_DATE",
      status: "ACTIVE", recordStatus: "ACTUAL", initialChicks: flock.birds, chickCostMinor: 0,
      slaughterDecisionMode: flock.productionType === "BROILER" ? "AGE_OR_WEIGHT" : "MANUAL",
      placementNotes: placementNotes || null,
      birdCounts: { create: { date: recordedAt, liveCount: flock.birds, note: "Initial farm setup count" } },
      ...(layerStage ? { layerStageEvents: { create: { farmId, toStage: layerStage, date: recordedAt, reason: "INITIAL_SETUP" } } } : {}),
    } });
  }
}
