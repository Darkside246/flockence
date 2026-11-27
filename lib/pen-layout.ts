import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { buildVisionReport, periodFor } from "@/lib/vision-reports";
import { visionPens } from "@/lib/vision-pens";
import { layoutSchema } from "@/lib/vision-assessment";
import { penLayoutAdvice, summariseSightings, type PenRecord } from "@/lib/pen-layout-rules.mjs";

/**
 * Pen size and layout advice for one pen (lib/pen-layout-rules.mjs): the pen's saved size and equipment, its live birds
 * and latest weight from the flock records, and what Vision saw there over the last 7 days. Reads only; costs nothing.
 */
export async function penLayout(penId: string) {
  const [pen] = await visionPens(penId);
  if (!pen) return null;
  const row = await prisma.setting.findFirst({ where: { id: penId, farmId: currentFarmId() }, select: { value: true } });
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(row?.value ?? "{}"); } catch { /* treat as empty */ }
  const num = (k: string) => Math.max(0, Number(saved[k]) || 0);
  const record: PenRecord = {
    lengthM: num("lengthM"), widthM: num("widthM"), housingMode: typeof saved.housingMode === "string" ? saved.housingMode : "OPEN_SIDED_HOT",
    feederPans: num("feederPans"), nipples: num("nipples"), bellDrinkers: num("bellDrinkers"), heatSources: num("heatSources"), fans: num("fans"),
  };

  // Birds in this pen now, from the flock records (the same pen matching the reports use).
  const period = periodFor("24h");
  const report = period ? await buildVisionReport({ kind: "PEN", id: penId }, period) : null;
  const flocks = report?.flocks ?? [];
  const live = flocks.reduce((s, f) => s + (f.liveRecorded ?? 0), 0);
  let weightKg: number | null = null;
  if (flocks.length) {
    const weights = await Promise.all(flocks.map((f) => prisma.weightRecord.findFirst({
      where: { batchId: f.id, liveOrDressed: "LIVE" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { avgWeightKg: true },
    })));
    const known = flocks.map((f, i) => ({ live: f.liveRecorded ?? 0, w: weights[i] ? Number(weights[i]!.avgWeightKg) : null })).filter((x) => x.w != null && x.live > 0);
    const birds = known.reduce((s, x) => s + x.live, 0);
    if (birds) weightKg = Math.round((known.reduce((s, x) => s + x.live * (x.w as number), 0) / birds) * 1000) / 1000;
  }

  // What Vision saw in this pen in the last 7 days.
  const rows = await prisma.healthObservation.findMany({
    where: { farmId: currentFarmId(), category: { startsWith: "VISION:" }, observedAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, visionAssessment: { path: ["pen", "id"], equals: penId } },
    orderBy: { observedAt: "desc" }, take: 60, select: { visionAssessment: true },
  });
  const sightings = rows.map((r) => {
    const parsed = layoutSchema.safeParse((r.visionAssessment as { layout?: unknown } | null)?.layout);
    return { layout: parsed.success ? parsed.data : null };
  });
  const advice = penLayoutAdvice({ pen: record, live, weightKg, seen: summariseSightings(sightings) });
  return { pen: { id: pen.id, name: pen.name, lengthM: record.lengthM || null, widthM: record.widthM || null, housingMode: record.housingMode }, flocks: flocks.map((f) => ({ name: f.name, ageDays: f.ageDays, live: f.liveRecorded })), ...advice };
}
