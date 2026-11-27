import { prisma } from "@/lib/prisma";
import { currentFarmId, runAsFarm, runUnscoped } from "@/lib/farm-scope";
import { calendarDateInTimeZone, FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";
import { accountPreferences } from "@/lib/account-preferences";
import { buildVisionReport, periodFor } from "@/lib/vision-reports";
import { sendVisionReportEmail } from "@/lib/mail";
import { dailyEmail, isDue, parseSettings, recipientsToSend, worthSending, type DailySettings, type DailyState } from "@/lib/vision-daily-report-rules.mjs";

/**
 * The daily Vision email (Vision Intelligence phase 1c). Each farm's report covers the last 24 hours and goes out once a
 * day from the farm's chosen hour (farm time), to owners and managers who ticked "Farm reports" on their Account page.
 * It runs from the automatic camera round (every 10 minutes), so it needs no extra server set-up. A failed send is tried
 * again on the next round; each person gets at most one report a day (recorded per person, and Resend's
 * Idempotency-Key guards a crash between sending and recording).
 */
export const SETTINGS_KEY = "VISION_DAILY_REPORT";
const STATE_KEY = "VISION_DAILY_REPORT_STATE";

export async function loadDailySettings(): Promise<DailySettings> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: SETTINGS_KEY } }, select: { value: true } });
  return parseSettings(row?.value);
}

export async function saveDailySettings(settings: DailySettings) {
  const farmId = currentFarmId(), value = JSON.stringify(settings);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: SETTINGS_KEY } }, create: { farmId, key: SETTINGS_KEY, value }, update: { value } });
}

async function loadState(): Promise<DailyState | null> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: STATE_KEY } }, select: { value: true } });
  try { return row ? JSON.parse(row.value) as DailyState : null; } catch { return null; }
}

async function saveState(state: DailyState) {
  const farmId = currentFarmId(), value = JSON.stringify(state);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: STATE_KEY } }, create: { farmId, key: STATE_KEY, value }, update: { value } });
}

/** Owners and managers of this farm, and whether each chose report emails. */
export async function reportPeople() {
  const users = await prisma.user.findMany({ where: { farmId: currentFarmId(), role: { in: ["OWNER", "MANAGER"] } }, select: { id: true, email: true, name: true, role: true } });
  return Promise.all(users.map(async (u) => ({ ...u, wantsReports: (await accountPreferences(currentFarmId(), u.id)).farmReportEmail })));
}

export function farmLocal(now: Date) {
  const date = calendarDateInTimeZone(now, FARM_TIME_ZONE) ?? now.toISOString().slice(0, 10);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  return { date, hour };
}

export type DailyResult = { farmId: string; sent: number; skipped?: string; failed?: number };

/** This farm's report, if it is due now. */
export async function runFarmDailyReport(now: Date, send = sendVisionReportEmail): Promise<DailyResult | null> {
  const farmId = currentFarmId();
  const settings = await loadDailySettings();
  const local = farmLocal(now);
  const state = await loadState();
  if (!isDue(settings, local, state)) return null;
  const today: DailyState = state?.date === local.date ? { ...state, sentTo: state.sentTo ?? [] } : { date: local.date, sentTo: [], done: false };

  const people = recipientsToSend(await reportPeople(), today, local.date);
  if (!people.length) { await saveState({ ...today, done: true, skipped: "nobody chose report emails" }); return { farmId, sent: 0, skipped: "nobody chose report emails" }; }
  const period = periodFor("24h", now);
  const report = period ? await buildVisionReport({ kind: "FARM" }, period) : null;
  if (!report) return { farmId, sent: 0, skipped: "report could not be built" };
  if (!worthSending(report)) { await saveState({ ...today, done: true, skipped: "no pictures and nothing open" }); return { farmId, sent: 0, skipped: "no pictures and nothing open" }; }

  const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
  // The Farm Vision page has the reports on every plan (Free farms have no Cameras page).
  let link = "/vision#reports";
  try { link = new URL("/vision#reports", process.env.APP_URL ?? "").href; } catch { /* relative link if APP_URL is unset */ }
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, weekday: "short", day: "numeric", month: "short" }).format(now);
  const email = dailyEmail(report, farm?.name ?? "Your farm", dateLabel, link);

  let sent = 0, failed = 0;
  for (const person of people) {
    const ok = await send(person.email, email, `flockence-vision-daily-${farmId}-${local.date}-${person.id}`).catch(() => false);
    if (ok) { sent += 1; today.sentTo.push(person.id); await saveState(today); } else failed += 1;
  }
  if (!failed) await saveState({ ...today, done: true });
  return { farmId, sent, ...(failed ? { failed } : {}) };
}

/** Every farm whose daily report is due. One farm's failure never stops the others. */
export async function runDailyReports(now = new Date()): Promise<DailyResult[]> {
  const farms = await runUnscoped(() => prisma.farm.findMany({ select: { id: true } }));
  const results: DailyResult[] = [];
  for (const { id } of farms) {
    const r = await runAsFarm(id, () => runFarmDailyReport(now)).catch((error) => ({ farmId: id, sent: 0, skipped: `error: ${error instanceof Error ? error.name : "unknown"}` }));
    if (r) results.push(r);
  }
  return results;
}
