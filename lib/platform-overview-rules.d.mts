export const QUIET_DAYS: number;
export type FarmRow = {
  id: string; name: string; createdAt: Date; members: number; owners: { name: string; email: string }[];
  activeFlocks: number; lastActivity: Date | null; quietDays: number | null; storageBytes: number;
  visionChecks: number; visionCostMicros: number; flags: string[];
};
export function buildFarmRows(
  farms: { id: string; name: string; createdAt: Date }[],
  facts: {
    users: Map<string, { total: number; owners: { name: string; email: string }[] }>;
    activeFlocks: Map<string, number>;
    lastActivity: Map<string, Date>;
    storageBytes: Map<string, number>;
    visionMonth: Map<string, { checks: number; costMicros: number }>;
    deletionPending: Set<string>;
  },
  now: Date,
): FarmRow[];
export function platformTotals(rows: FarmRow[]): {
  farms: number; members: number; activeFlocks: number; storageBytes: number;
  visionChecks: number; visionCostMicros: number; needAttention: number;
};
export function formatUsd(micros: number): string;
export function readVisionMonth(text: string | null | undefined): { checks: number; costMicros: number };
