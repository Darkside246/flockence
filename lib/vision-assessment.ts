import { z } from "zod";

export const assessmentCategories = [
  "BEHAVIOR", "DISTRIBUTION", "LITTER", "COMFORT", "FEED_WATER", "EQUIPMENT", "VISIBLE_HEALTH",
] as const;

const confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
const severity = z.enum(["LOW", "MEDIUM", "MODERATE", "HIGH", "URGENT"]);
const label = z.string().trim().min(1).max(160);
const detail = z.string().trim().max(700);
const category = z.enum(assessmentCategories);
const signal = z.discriminatedUnion("state", [
  z.object({ category, state: z.literal("NOT_OBSERVED") }),
  z.object({
    category, state: z.enum(["NORMAL", "ATTENTION", "WARNING", "CRITICAL"]),
    evidence: detail.min(1),
  }),
]);

export const visionResultSchema = z.object({
  summary: detail.min(1),
  confidence: confidence.optional(),
  severity: severity.optional(),
  observations: z.array(z.object({ title: label, detail, confidence: confidence.optional() })).max(16).default([]),
  concerns: z.array(z.object({ title: label, whyItMatters: detail })).max(12).default([]),
  checks: z.array(detail.min(1)).max(12).default([]),
  escalate: z.boolean().default(false),
  escalationReason: detail.optional(),
  medicalDisclaimer: detail.optional(),
  signals: z.array(signal).max(7).default([]),
  // Approximate count of the birds visible in the picture (never the whole flock), and questions when unsure.
  birdCount: z.object({ visible: z.number().int().min(0).max(100000).nullable(), confidence: confidence.optional(), note: detail.optional() }).nullable().optional().catch(null),
  questions: z.array(detail.min(1)).max(3).optional().catch([]),
  notVisible: z.array(detail.min(1)).max(8).optional().catch([]),
  stillBirds: z.array(z.object({ where: detail.min(1), why: detail.optional(), confidence: confidence.optional() })).max(10).optional().catch([]),
});

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UPLOAD") }),
  z.object({ kind: z.literal("CAMERA"), name: z.string().min(1).max(128), provider: z.enum(["blink", "rtsp"]) }),
]);

export const visionAssessmentSchema = z.object({
  version: z.literal(1),
  model: z.string().min(1).max(200),
  source,
  inspectionCategory: label,
  status: z.enum(["INSUFFICIENT_EVIDENCE", "GOOD", "ATTENTION", "WARNING", "CRITICAL"]),
  signals: z.array(signal).length(7),
  confidence: confidence.nullable(),
  summary: detail.min(1),
  checks: z.array(detail.min(1)).max(12),
  evidenceId: label,
  capture: z.object({ mode: z.literal("VIDEO_SAMPLE"), frames: z.literal(3) }).optional(),
  pen: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string().min(1).max(120) }).optional(),
});

type VisionResult = z.infer<typeof visionResultSchema>;
type VisionAssessment = z.infer<typeof visionAssessmentSchema>;
type AssessmentRecord = { id: string; batchId: string | null; observedAt: Date; visionAssessment: unknown };

export function createVisionAssessment(result: VisionResult, input: {
  model: string; source: VisionAssessment["source"]; inspectionCategory: string; evidenceId: string; pen?: VisionAssessment["pen"]; capture?: VisionAssessment["capture"];
}): VisionAssessment {
  const signals = assessmentCategories.map((categoryName) => {
    const candidates = result.signals.filter((row) => row.category === categoryName);
    const stateRank = { NOT_OBSERVED: 0, NORMAL: 1, ATTENTION: 2, WARNING: 3, CRITICAL: 4 };
    return candidates.reduce<z.infer<typeof signal>>((best, current) =>
      stateRank[current.state] > stateRank[best.state] ? current : best,
      { category: categoryName, state: "NOT_OBSERVED" });
  });
  const rank = new Set(signals.map((entry) => entry.state));
  const hasEvidence = signals.some((entry) => entry.state !== "NOT_OBSERVED")
    || result.observations.some((entry) => entry.detail.length > 0);
  const status = rank.has("CRITICAL") || (hasEvidence && result.severity === "URGENT") ? "CRITICAL"
    : rank.has("WARNING") || (hasEvidence && result.severity === "HIGH") ? "WARNING"
    : rank.has("ATTENTION") || (hasEvidence && result.escalate) ? "ATTENTION"
    : rank.has("NOT_OBSERVED") || !result.confidence || result.confidence === "LOW" ? "INSUFFICIENT_EVIDENCE"
    : "GOOD";
  return {
    version: 1, ...input, status, signals,
    confidence: result.confidence ?? null, summary: result.summary, checks: result.checks,
  };
}

export function compareVisionAssessments(a: AssessmentRecord, b: AssessmentRecord) {
  const [older, newer] = a.observedAt <= b.observedAt ? [a, b] : [b, a];
  const from = visionAssessmentSchema.safeParse(older.visionAssessment);
  const to = visionAssessmentSchema.safeParse(newer.visionAssessment);
  if (!from.success || !to.success) return null;
  const x = from.data;
  const y = to.data;
  if (older.id === newer.id || older.observedAt.getTime() === newer.observedAt.getTime()
    || x.source.kind !== "CAMERA" || y.source.kind !== "CAMERA"
    || x.source.name !== y.source.name || x.source.provider !== y.source.provider
    || x.capture?.mode !== y.capture?.mode || x.pen?.id !== y.pen?.id || x.model !== y.model || x.inspectionCategory !== y.inspectionCategory || older.batchId !== newer.batchId) return null;
  const changes = assessmentCategories.flatMap((name) => {
    const before = x.signals.find((entry) => entry.category === name);
    const after = y.signals.find((entry) => entry.category === name);
    if (!before || !after || before.state === "NOT_OBSERVED" || after.state === "NOT_OBSERVED") return [];
    return [{ category: name, before: before.state, after: after.state, earlierEvidence: before.evidence, laterEvidence: after.evidence }];
  });
  return {
    version: 1, camera: x.source.name, earlier: { id: older.id, at: older.observedAt, status: x.status },
    later: { id: newer.id, at: newer.observedAt, status: y.status }, changes,
  };
}
