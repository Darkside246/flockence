import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import {
  OPEN_STATES, findingsFromAnalysis, higher, incidentKey, joinsIncident, reviewFinding,
  type FindingSeverity, type NewFinding,
} from "@/lib/vision-findings-rules.mjs";

/**
 * Vision findings in the database (Vision Intelligence phase 1). Every inspection's answer becomes findings; a repeat
 * sighting of the same kind in the same pen within 48 hours updates the open incident (seen again, worst severity kept)
 * instead of adding a new alert. People confirm, dismiss or resolve them; each change is kept in the history.
 */
/** What one inspection did to the farm's findings: each finding it created or added to, as it now stands. */
export type RecordedFinding = { id: string; created: boolean; kind: string; title: string; detail: string | null; severity: string; state: string; penName: string | null; cameraName: string | null; evidenceUrl: string | null };

export async function recordFindings(input: {
  analysis: unknown; expectedLive: number | null; at: Date;
  pen?: { id: string; name: string } | null; batchId: string | null; cameraName?: string | null;
  observationId: string; evidenceUrl: string | null;
}) {
  const found: NewFinding[] = findingsFromAnalysis(input.analysis, { expectedLive: input.expectedLive });
  if (!found.length) return [] as RecordedFinding[];
  const farmId = currentFarmId();
  const out: RecordedFinding[] = [];
  for (const f of found) {
    const key = incidentKey(f.kind, { penId: input.pen?.id ?? null, cameraName: input.cameraName ?? null });
    const row = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId + ":" + key}, 0))::text`;
      const open = await tx.visionFinding.findFirst({ where: { farmId, incidentKey: key, state: { in: OPEN_STATES } }, orderBy: { lastSeenAt: "desc" } });
      if (open && joinsIncident(open, input.at)) {
        const updated = await tx.visionFinding.update({ where: { id: open.id }, data: {
          lastSeenAt: input.at > open.lastSeenAt ? input.at : open.lastSeenAt, occurrences: { increment: 1 },
          severity: higher(open.severity as FindingSeverity, f.severity), detail: f.detail, confidence: f.confidence ?? open.confidence,
          observationId: input.observationId, evidenceUrl: input.evidenceUrl ?? open.evidenceUrl,
        } });
        return { row: updated, created: false };
      }
      const created = await tx.visionFinding.create({ data: {
        farmId, kind: f.kind, title: f.title, detail: f.detail, severity: f.severity, state: f.state, confidence: f.confidence,
        incidentKey: key, penId: input.pen?.id ?? null, penName: input.pen?.name ?? null, batchId: input.batchId,
        cameraName: input.cameraName ?? null, firstSeenAt: input.at, lastSeenAt: input.at,
        observationId: input.observationId, evidenceUrl: input.evidenceUrl,
        history: [{ at: input.at.toISOString(), from: null, to: f.state, by: "Vision", note: "" }],
      } });
      return { row: created, created: true };
    }, { maxWait: 15_000, timeout: 15_000 });
    const r = row.row;
    out.push({ id: r.id, created: row.created, kind: r.kind, title: r.title, detail: r.detail, severity: r.severity, state: r.state, penName: r.penName, cameraName: r.cameraName, evidenceUrl: r.evidenceUrl });
  }
  return out;
}

export async function listFindings(filter: { open?: boolean; penId?: string; from?: Date; to?: Date; take?: number }) {
  return prisma.visionFinding.findMany({
    where: {
      farmId: currentFarmId(),
      ...(filter.open ? { state: { in: OPEN_STATES } } : {}),
      ...(filter.penId ? { penId: filter.penId } : {}),
      ...(filter.from || filter.to ? { lastSeenAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }], take: Math.min(filter.take ?? 100, 300),
  });
}

/** A person's review. Only this farm's finding; the original wording stays, and the change is added to its history. */
export async function reviewVisionFinding(id: string, input: { state?: string; note?: unknown }, user: { id: string; name: string }) {
  const farmId = currentFarmId();
  return prisma.$transaction(async (tx) => {
    const current = await tx.visionFinding.findFirst({ where: { id, farmId } });
    if (!current) return { ok: false as const, status: 404, error: "Finding not found." };
    const checked = reviewFinding(current, input, user.name || "Farm user", new Date());
    if (!checked.ok) return { ok: false as const, status: 400, error: checked.error };
    const history = [...(Array.isArray(current.history) ? current.history : []), checked.entry];
    const updated = await tx.visionFinding.update({ where: { id }, data: { state: checked.state, history } });
    await tx.auditLog.create({ data: {
      farmId, userId: user.id, action: "VISION_FINDING_REVIEWED", entity: "VisionFinding", entityId: id,
      beforeJson: JSON.stringify({ state: current.state }), afterJson: JSON.stringify({ state: checked.state, note: checked.entry.note }),
    } });
    return { ok: true as const, finding: updated };
  });
}

/**
 * A pen's history in date order: each inspection's summary, each finding when first seen, and each person's review.
 * The camera-to-pen history decides which inspections belong to the pen at the time they were taken.
 */
export async function penTimeline(penId: string, from: Date, to: Date) {
  const farmId = currentFarmId();
  const [observations, findings] = await Promise.all([
    prisma.healthObservation.findMany({
      where: { farmId, category: { startsWith: "VISION:" }, observedAt: { gte: from, lte: to }, visionAssessment: { path: ["pen", "id"], equals: penId } },
      orderBy: { observedAt: "asc" }, take: 500, select: { id: true, observedAt: true, notes: true, imageUrl: true, visionAssessment: true },
    }),
    prisma.visionFinding.findMany({ where: { farmId, penId, OR: [{ firstSeenAt: { gte: from, lte: to } }, { lastSeenAt: { gte: from, lte: to } }] }, orderBy: { firstSeenAt: "asc" } }),
  ]);
  type Entry = { at: string; kind: "inspection" | "finding" | "review"; text: string; severity?: string; findingId?: string; imageUrl?: string | null };
  const entries: Entry[] = [];
  for (const o of observations) {
    const summary = o.notes?.split("\n").find((l) => l.startsWith("Summary:"))?.slice(8).trim() || "Inspection recorded.";
    entries.push({ at: o.observedAt.toISOString(), kind: "inspection", text: summary, imageUrl: o.imageUrl });
  }
  for (const f of findings) {
    entries.push({ at: f.firstSeenAt.toISOString(), kind: "finding", text: `${f.title}${f.occurrences > 1 ? ` (seen ${f.occurrences} times, last ${f.lastSeenAt.toISOString()})` : ""}`, severity: f.severity, findingId: f.id });
    for (const h of Array.isArray(f.history) ? f.history as { at: string; from: string | null; to: string; by: string; note: string }[] : []) {
      if (h.from === null) continue;
      entries.push({ at: h.at, kind: "review", text: `${h.by} marked "${f.title}" as ${h.to.toLowerCase().replaceAll("_", " ")}${h.note ? `: ${h.note}` : ""}`, findingId: f.id });
    }
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
