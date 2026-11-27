import { prisma } from "@/lib/prisma";
import { currentFarmId, runAsFarm, runUnscoped } from "@/lib/farm-scope";

/**
 * People in the pictures (Vision Intelligence phase 5): privacy first.
 *  - Vision is told never to describe or identify anyone (no faces, names, age, gender, skin, hair or clothing colour,
 *    no matching a person across pictures). It only says how many people are in view, the work being done, and
 *    whether boots and coveralls can be seen.
 *  - The people timeline is OFF until the owner switches it on. While it is off, nothing about people is saved.
 *  - While it is on, people data is kept for `keepDays` (default 30) and then removed from the saved inspections by
 *    the automatic round; the rest of each inspection stays.
 */
const KEY = "VISION_PEOPLE";
export type PeopleSettings = { timeline: boolean; keepDays: number };
export const PEOPLE_DEFAULTS: PeopleSettings = { timeline: false, keepDays: 30 };

export function parsePeopleSettings(value: string | null | undefined): PeopleSettings {
  try {
    const v = JSON.parse(value ?? "");
    return {
      timeline: v?.timeline === true,
      keepDays: Number.isInteger(v?.keepDays) && v.keepDays >= 1 && v.keepDays <= 90 ? v.keepDays : PEOPLE_DEFAULTS.keepDays,
    };
  } catch {
    return { ...PEOPLE_DEFAULTS };
  }
}

export async function peopleSettings(): Promise<PeopleSettings> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: KEY } }, select: { value: true } });
  return parsePeopleSettings(row?.value);
}

export async function savePeopleSettings(settings: PeopleSettings) {
  const farmId = currentFarmId(), value = JSON.stringify(settings);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: KEY } }, create: { farmId, key: KEY, value }, update: { value } });
  // Switching the timeline off removes the people data already kept.
  if (!settings.timeline) await removePeopleData(null);
}

/** Remove people data saved before `before` (all of it when null) from this farm's inspections. Returns how many. */
export async function removePeopleData(before: Date | null, limit = 500) {
  const rows = await prisma.healthObservation.findMany({
    where: { farmId: currentFarmId(), category: { startsWith: "VISION:" }, ...(before ? { observedAt: { lt: before } } : {}), visionAssessment: { path: ["people"], not: { equals: null } } },
    select: { id: true, visionAssessment: true }, take: limit,
  });
  let cleaned = 0;
  for (const row of rows) {
    const a = row.visionAssessment as Record<string, unknown> | null;
    if (!a || !("people" in a)) continue;
    const rest = { ...a };
    delete rest.people;
    await prisma.healthObservation.update({ where: { id: row.id }, data: { visionAssessment: rest as object } });
    cleaned += 1;
  }
  return cleaned;
}

/** The retention clean-up for every farm, run with the automatic round. */
export async function runPeopleRetention(now = new Date()) {
  const farms = await runUnscoped(() => prisma.farm.findMany({ select: { id: true } }));
  let cleaned = 0;
  for (const { id } of farms) {
    cleaned += await runAsFarm(id, async () => {
      const s = await peopleSettings();
      return removePeopleData(s.timeline ? new Date(now.getTime() - s.keepDays * 86_400_000) : null);
    }).catch(() => 0);
  }
  return cleaned;
}
