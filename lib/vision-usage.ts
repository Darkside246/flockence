import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { FARM_TIME_ZONE, calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
import type { VisionUsage } from "@/lib/vision-provider";

/**
 * What Farm Vision costs each farm, per calendar month (farm time): checks run (manual and automatic), tokens and the
 * cost at the recorded prices. Used for the plan limits and shown to owners, so the price of the service can be set from
 * real numbers. Kept as one farm setting per month (VISION_USAGE::YYYY-MM).
 */
export type MonthUsage = {
  month: string; manual: number; automatic: number; rechecks: number;
  inputTokens: number; outputTokens: number; costMicros: number; unpricedCalls: number;
  byModel: Record<string, { calls: number; costMicros: number }>;
};

export const monthKey = (now = new Date()) => (calendarDateInTimeZone(now, FARM_TIME_ZONE) ?? now.toISOString()).slice(0, 7);
const keyFor = (month: string) => `VISION_USAGE::${month}`;
const empty = (month: string): MonthUsage => ({ month, manual: 0, automatic: 0, rechecks: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, unpricedCalls: 0, byModel: {} });

function read(month: string, text: string | null | undefined): MonthUsage {
  try {
    const v = JSON.parse(text ?? "") as Partial<MonthUsage>;
    const base = empty(month);
    for (const k of ["manual", "automatic", "rechecks", "inputTokens", "outputTokens", "costMicros", "unpricedCalls"] as const) {
      if (Number.isFinite(v[k])) base[k] = Number(v[k]);
    }
    if (v.byModel && typeof v.byModel === "object") base.byModel = v.byModel as MonthUsage["byModel"];
    return base;
  } catch { return empty(month); }
}

export async function monthUsage(now = new Date()): Promise<MonthUsage> {
  const month = monthKey(now);
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: keyFor(month) } }, select: { value: true } });
  return read(month, row?.value);
}

/** Add one inspection's model calls (the first look, and a re-check if one ran). Safe under concurrent inspections. */
export async function recordVisionUsage(input: { automatic: boolean; calls: VisionUsage[]; counted: boolean }, now = new Date()) {
  if (!input.calls.length && !input.counted) return;
  const farmId = currentFarmId();
  const month = monthKey(now);
  const key = keyFor(month);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId + ":" + key}, 0))::text`;
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key } }, select: { value: true } });
    const usage = read(month, row?.value);
    if (input.counted) { if (input.automatic) usage.automatic += 1; else usage.manual += 1; }
    usage.rechecks += Math.max(0, input.calls.length - 1);
    for (const call of input.calls) {
      usage.inputTokens += call.inputTokens;
      usage.outputTokens += call.outputTokens;
      if (call.costMicros == null) usage.unpricedCalls += 1; else usage.costMicros += call.costMicros;
      const line = usage.byModel[call.model] ?? { calls: 0, costMicros: 0 };
      line.calls += 1;
      line.costMicros += call.costMicros ?? 0;
      usage.byModel[call.model] = line;
    }
    const value = JSON.stringify(usage);
    await tx.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
  }, { maxWait: 15_000, timeout: 15_000 });
}
