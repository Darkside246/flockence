export type Clip = { id: string; camera: string; createdAt: string; source: string; media: string | null };
export type RecordingState = { done: Record<string, string>; covered: Record<string, string> };
export type Pick = { clip: Clip; camera: string; part: string };
export const DAY_PARTS: { name: string; from: number; to: number }[];
export const RECORDINGS_PER_ROUND: number;
export function partOf(hour: number): string;
export function pickRecordingChecks(clips: Clip[], state: RecordingState | null, now: Date, hourOf: (d: Date) => number, limit?: number, cameras?: string[] | null): Pick[];
export function markChecked(state: RecordingState | null, pick: Pick, now: Date): RecordingState;
export function missingParts(clips: Clip[], cameras: string[], now: Date, hourOf: (d: Date) => number): Record<string, string[]>;
