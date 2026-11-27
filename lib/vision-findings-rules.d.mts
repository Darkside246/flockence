export type FindingKind = "DEAD_OR_DOWN_BIRD" | "THERMAL" | "LITTER" | "FEED_WATER" | "EQUIPMENT" | "HEALTH" | "BEHAVIOUR" | "POPULATION";
export type FindingSeverity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";
export type FindingState = "OBSERVED" | "SUSPECTED" | "REQUIRES_INSPECTION" | "INCONCLUSIVE" | "CONFIRMED" | "DISMISSED" | "RESOLVED";
export type NewFinding = { kind: FindingKind; severity: FindingSeverity; state: FindingState; confidence: string | null; title: string; detail: string };
export const KINDS: FindingKind[];
export const SEVERITIES: FindingSeverity[];
export const OPEN_STATES: FindingState[];
export const REVIEW_STATES: FindingState[];
export const KIND_LABELS: Record<FindingKind, string>;
export const INCIDENT_WINDOW_MS: number;
export function higher(a: FindingSeverity, b: FindingSeverity): FindingSeverity;
export function findingsFromAnalysis(analysis: unknown, options?: { expectedLive?: number | null; eggCounts?: boolean }): NewFinding[];
export function incidentKey(kind: string, where?: { penId?: string | null; cameraName?: string | null }): string;
export function joinsIncident(existing: { state: string; lastSeenAt: Date | string } | null | undefined, now: Date): boolean;
export function reviewFinding(
  current: { state: string }, input: { state?: string; note?: unknown } | null, by: string, now: Date,
): { ok: true; state: FindingState; entry: { at: string; from: string; to: string; by: string; note: string } } | { ok: false; error: string };
