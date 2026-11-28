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

const count = z.number().int().min(0).max(500).nullable().optional().catch(null);
export const layoutSchema = z.object({
  view: z.enum(["WHOLE_PEN", "MOST_OF_PEN", "PART_OF_PEN"]).optional().catch(undefined),
  feeders: count, drinkers: count, heaters: count, fans: count,
  crowding: z.array(z.object({ at: z.enum(["FEEDER", "DRINKER", "HEATER", "WALL", "CORNER", "OTHER"]).catch("OTHER"), note: detail.optional().catch(undefined) })).max(8).optional().catch([]),
  emptyAreas: z.array(detail.min(1)).max(6).optional().catch([]),
});

const eggCount = z.number().int().min(0).max(10000).nullable().optional().catch(null);
export const eggsSchema = z.object({
  nestEggs: eggCount, floorEggs: eggCount,
  floorEggAreas: z.array(detail.min(1)).max(6).optional().catch([]),
  nestBoxes: z.enum(["OPEN", "CLOSED", "NOT_VISIBLE"]).optional().catch(undefined),
});

export const animalsSchema = z.array(z.object({
  kind: z.enum(["RODENT", "WILD_BIRD", "DOG", "CAT", "OTHER"]).catch("OTHER"), where: detail.optional().catch(undefined), confidence: confidence.optional().catch(undefined),
})).max(10);
const wear = z.enum(["SEEN", "NOT_SEEN", "UNCLEAR"]).optional().catch(undefined);
/** People in view, with no identity (no faces, names or descriptions): only kept when the farm switched the timeline on. */
export const peopleSchema = z.object({
  inView: z.number().int().min(0).max(50).catch(0),
  activity: z.enum(["FEEDING", "WATERING", "CLEANING", "COLLECTING_EGGS", "CHECKING_BIRDS", "MAINTENANCE", "OTHER", "NONE"]).optional().catch(undefined),
  boots: wear, coveralls: wear,
});

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
  // Animals and pests at or in the house (biosecurity), and people in view with no identity (Vision Intelligence phase 5).
  animals: animalsSchema.optional().catch([]),
  people: peopleSchema.nullable().optional().catch(null),
  // Eggs seen in a layer house: nest and floor eggs (Vision Intelligence phase 4; counts shown only once validated).
  eggs: eggsSchema.nullable().optional().catch(null),
  // Equipment and crowding seen in a pen picture, for the pen layout advice (lib/pen-layout-rules.mjs).
  layout: layoutSchema.nullable().optional().catch(null),
});

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UPLOAD") }),
  z.object({ kind: z.literal("CAMERA"), name: z.string().min(1).max(128), provider: z.enum(["blink", "rtsp", "wyze"]) }),
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
  capture: z.union([
    z.object({ mode: z.literal("VIDEO_SAMPLE"), frames: z.literal(3) }),
    // Frames from a saved recording, filed at the time it was filmed (lib/vision-recordings.ts).
    z.object({ mode: z.literal("RECORDING"), frames: z.number().int().min(1).max(3), clipAt: z.string().max(40) }),
  ]).optional(),
  pen: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string().min(1).max(120) }).optional(),
  layout: layoutSchema.optional().catch(undefined),
  eggs: eggsSchema.optional().catch(undefined),
  animals: animalsSchema.optional().catch(undefined),
  people: peopleSchema.optional().catch(undefined),
  /** The bird counter's result, when the farm has it switched on (lib/bird-detector.ts). */
  detector: z.object({
    model: z.string().max(80), count: z.number().int().min(0), counts: z.array(z.number().int().min(0)).max(3),
    still: z.array(z.object({ where: z.string().max(40), box: z.array(z.number()).length(4) })).max(50),
  }).optional().catch(undefined),
  /** What the model itself counted (Vision Intelligence phase 2: measured against the farmer's labels). */
  seen: z.object({ birds: z.number().int().min(0).max(100000).nullable(), stillBirds: z.number().int().min(0).max(50) }).optional().catch(undefined),
  /** The phone's upload id, so a retried upload is recognised (lib/vision-upload-requests.ts). */
  requestId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/).optional(),
});

type VisionResult = z.infer<typeof visionResultSchema>;
type VisionAssessment = z.infer<typeof visionAssessmentSchema>;
type AssessmentRecord = { id: string; batchId: string | null; observedAt: Date; visionAssessment: unknown };

export function createVisionAssessment(result: VisionResult, input: {
  model: string; source: VisionAssessment["source"]; inspectionCategory: string; evidenceId: string; pen?: VisionAssessment["pen"]; capture?: VisionAssessment["capture"]; requestId?: string;
  /** Keep people in view (the farm's people timeline is on). When false, nothing about people is saved. */
  keepPeople?: boolean;
  detector?: VisionAssessment["detector"];
}): VisionAssessment {
  const { keepPeople, ...saved } = input;
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
    version: 1, ...saved, status, signals,
    confidence: result.confidence ?? null, summary: result.summary, checks: result.checks,
    seen: { birds: result.birdCount?.visible ?? null, stillBirds: result.stillBirds?.length ?? 0 },
    ...(result.layout ? { layout: result.layout } : {}),
    ...(result.eggs ? { eggs: result.eggs } : {}),
    ...(Array.isArray(result.animals) ? { animals: result.animals } : {}),
    ...(keepPeople && result.people && result.people.inView > 0 ? { people: result.people } : {}),
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
