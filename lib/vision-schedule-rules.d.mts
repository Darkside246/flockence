export type ScheduleCamera = { everyHours: number; mode: "video" | "still"; category: "PEN" | "FLOCK" | "FEED" | "WATER" | "EQUIPMENT" | "OTHER" };
export type Schedule = { enabled: boolean; cameras: Record<string, ScheduleCamera>; dailyCap: number; keepDays: number; quietStart: string; quietEnd: string };
export type CameraState = {
  lastRunAt?: string; lastResult?: "ok" | "failed"; lastMessage?: string; lastObservationId?: string | null;
  lastSeverity?: string | null; failures?: number; needsAttention?: boolean;
  /** Birds the vision model could see (never the flock total), and what Oriya answered when the farm is linked. */
  birdsVisible?: number | null; questions?: string[]; escalate?: boolean;
  oriya?: { sent: boolean; reason?: string; alerts?: number; birdsVisible?: number | null; whatsapp?: boolean } | null;
};
export type ScheduleState = { day: string; runsToday: number; leaseUntil: string; lastRoundAt: string; cameras: Record<string, CameraState> };

export const SCHEDULE_KEY: "VISION_AUTO_V1";
export const STATE_KEY: "VISION_AUTO_STATE_V1";
export const INTERVAL_HOURS: number[];
export const MODES: string[];
export const CATEGORIES: string[];
export const LIMITS: { dailyCapMin: number; dailyCapMax: number; keepDaysMin: number; keepDaysMax: number; camerasMax: number };
export const DEFAULTS: { dailyCap: number; keepDays: number; quietStart: string; quietEnd: string };
export const CAMERAS_PER_ROUND: number;
export const ATTENTION_AFTER_FAILURES: number;
export const LEASE_MS: number;
export function normaliseSchedule(input: unknown): { ok: true; schedule: Schedule } | { ok: false; error: string };
export function readSchedule(text: string | null | undefined): Schedule | null;
export function readState(text: string | null | undefined): ScheduleState;
export function clockInZone(now: Date, timeZone: string): string;
export function inQuietHours(clock: string, quietStart: string, quietEnd: string): boolean;
export function isDue(lastRunAt: string | undefined, everyHours: number, now: Date): boolean;
export function camerasToRun(schedule: Schedule | null, state: ScheduleState, now: Date, today: string): (ScheduleCamera & { name: string })[];
export function inspectionsPerDay(schedule: Schedule | null, quietMinutes?: number): number;
export function quietMinutes(quietStart: string, quietEnd: string): number;
export function recordAttempt(
  previous: CameraState | undefined, now: Date,
  outcome: { ok: true; summary?: string; observationId: string; severity?: string } | { ok: false; error: string },
): CameraState;

export type VisionPlan = "FREE" | "STANDARD" | "PREMIUM";
export type PlanLimits = { automatic: boolean; maxCameras: number; minIntervalHours: number; dailyCap: number; manualPerMonth: number; monthlyBudgetUsd: number };
export const DEFAULT_PLAN_LIMITS: Record<VisionPlan, PlanLimits>;
export const PLAN_LABELS: Record<VisionPlan, string>;
export function visionPlan(accessState: string, farmId: string, premiumFarms?: string): VisionPlan;
export function planLimits(plan: VisionPlan, overridesText?: string): PlanLimits;
export function fitScheduleToPlan(schedule: Schedule, limits: PlanLimits, planLabel?: string): { ok: true; schedule: Schedule } | { ok: false; error: string };
export function scheduleWithinPlan(schedule: Schedule | null, limits: PlanLimits): Schedule | null;
export function overBudget(costMicros: number, limits: PlanLimits): boolean;
