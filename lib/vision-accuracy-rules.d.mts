export const LABEL_PREFIX: string;
export const DEPENDABLE_AFTER: number;
export type VisionLabel = { birds: number | null; deadOrDown: number | null; floorEggs: number | null };
export type ModelSaid = { birds: number | null; stillBirds: number; detector: number | null; floorEggs: number | null };
export function cleanLabel(input: unknown): VisionLabel | null | undefined;
export function parseSavedLabel(text: string | null | undefined): (VisionLabel & { by: string | null; at: string | null }) | null;
export function modelSaid(assessment: unknown, notes: string | null | undefined): ModelSaid;
type CountError = { checks: number; meanMiss: number; meanMissPercent: number | null; within10Percent: number | null } | null;
export function accuracyReport(rows: { label: VisionLabel | null; said: ModelSaid }[], reviewedDeadBirdFindings?: { confirmed: number; dismissed: number }): {
  labelled: number; checks: number; dependable: boolean;
  birdCount: { model: CountError; counter: CountError };
  deadBirds: { checks: number; found: number; missed: number; falseAlarms: number; quiet: number; foundPercent: number | null; falseAlarmPercent: number | null };
  floorEggs: CountError;
  reviewedFindings: { confirmed: number; dismissed: number; rightPercent: number | null };
};
export function evaluationCsv(rows: { id: string; observedAt: string; camera: string | null; pen: string | null; imageUrl: string | null; label: VisionLabel | null; said: ModelSaid }[]): string;
