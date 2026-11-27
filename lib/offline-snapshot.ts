import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
import { inspectionContext } from "@/lib/vision-context";
import { visionAssessmentSchema } from "@/lib/vision-assessment";

/**
 * "Farm at a glance" for the offline page (public/offline.html): a read-only copy of what a worker needs in the pens with
 * no signal. It is fetched with the offline workspace and kept on the device encrypted with the device passphrase, like
 * the rest of the workspace, and shown with the time it was taken. For each active flock: the same record summary Vision
 * uses (age, live birds, deaths, feed and grams per bird, water, weight, house conditions, health and withdrawals, eggs)
 * and whether today's daily check is done; then open Vision findings and the latest Vision check of each pen.
 */
export type GlanceSection = { title: string; lines: string[] };
export type Snapshot = {
  takenAt: string;
  flocks: { id: string; name: string; dailyCheckToday: boolean; sections: GlanceSection[] }[];
  findings: { title: string; place: string | null; severity: string; lastSeenAt: string }[];
  pens: { name: string; status: string; summary: string; at: string }[];
};

const MAX_FLOCKS = 20;

export async function offlineSnapshot(now = new Date()): Promise<Snapshot> {
  const farmId = currentFarmId();
  const today = calendarDateInTimeZone(now) ?? now.toISOString().slice(0, 10);
  const flocks = await prisma.batch.findMany({ where: { farmId, status: "ACTIVE" }, orderBy: { name: "asc" }, take: MAX_FLOCKS, select: { id: true, name: true } });

  const glance = [];
  for (const f of flocks) {
    const [context, checks] = await Promise.all([
      inspectionContext({ batchId: f.id, category: "FLOCK", now }).catch(() => null),
      prisma.dailyFlockCheck.findMany({ where: { farmId, batchId: f.id, date: { gte: new Date(now.getTime() - 2 * 86_400_000) } }, select: { date: true } }),
    ]);
    glance.push({
      id: f.id, name: f.name,
      dailyCheckToday: checks.some((c) => c.date.toISOString().slice(0, 10) === today),
      sections: (context?.sections ?? []).filter((s) => s.key !== "TIME").map((s) => ({ title: s.title, lines: s.lines.slice(0, 6) })),
    });
  }

  const [open, recent] = await Promise.all([
    prisma.visionFinding.findMany({
      where: { farmId, state: { in: ["OBSERVED", "SUSPECTED", "REQUIRES_INSPECTION", "INCONCLUSIVE", "CONFIRMED"] } },
      orderBy: [{ lastSeenAt: "desc" }], take: 10, select: { title: true, penName: true, cameraName: true, severity: true, lastSeenAt: true },
    }),
    prisma.healthObservation.findMany({
      where: { farmId, category: { startsWith: "VISION:" }, observedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      orderBy: { observedAt: "desc" }, take: 120, select: { observedAt: true, visionAssessment: true },
    }),
  ]);
  const pens = new Map<string, Snapshot["pens"][number]>();
  for (const row of recent) {
    const a = visionAssessmentSchema.safeParse(row.visionAssessment);
    if (!a.success || !a.data.pen || pens.has(a.data.pen.id)) continue;
    pens.set(a.data.pen.id, { name: a.data.pen.name, status: a.data.status, summary: a.data.summary, at: row.observedAt.toISOString() });
  }
  return {
    takenAt: now.toISOString(),
    flocks: glance,
    findings: open.map((f) => ({ title: f.title, place: f.penName ?? f.cameraName, severity: f.severity, lastSeenAt: f.lastSeenAt.toISOString() })),
    pens: [...pens.values()].slice(0, 20),
  };
}
