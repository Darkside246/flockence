import { prisma } from "@/lib/prisma";
import { currentFarmId, runAsFarm, runUnscoped } from "@/lib/farm-scope";
import { parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { accountPreferences } from "@/lib/account-preferences";
import { farmBriefingToday } from "@/lib/farm-briefing";
import { farmLocal } from "@/lib/vision-daily-report";
import { sendFarmAlertEmail } from "@/lib/mail";
import { farmAlertEmail, planFarmAlerts, type FarmAlertState } from "@/lib/farm-alert-rules.mjs";

/**
 * Farm alert emails from the farm's own records (lib/farm-alert-rules.mjs has the rules). Runs from the automatic round
 * every 10 minutes, like the daily Vision report, so it needs no extra server set-up. Goes to owners and supervisors who
 * ticked "Farm alerts" on their Account page. State is kept per farm, so each item goes out at most once a farm day.
 */
const STATE_KEY = "FARM_ALERTS_STATE";

async function loadState(): Promise<FarmAlertState | null> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: STATE_KEY } }, select: { value: true } });
  try { return row ? JSON.parse(row.value) as FarmAlertState : null; } catch { return null; }
}

async function saveState(state: FarmAlertState) {
  const farmId = currentFarmId(), value = JSON.stringify(state);
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key: STATE_KEY } }, create: { farmId, key: STATE_KEY, value }, update: { value } });
}

export type FarmAlertResult = { farmId: string; sent: number; items?: number; failed?: number; skipped?: string };

/** This farm's alert email, if one is due now. */
export async function runFarmAlerts(now: Date, send = sendFarmAlertEmail): Promise<FarmAlertResult | null> {
  const farmId = currentFarmId();
  const users = await prisma.user.findMany({ where: { farmId, role: { in: ["OWNER", "MANAGER"] } }, select: { id: true, email: true } });
  const people = [];
  for (const u of users) if ((await accountPreferences(farmId, u.id)).farmAlertEmail) people.push(u);
  if (!people.length) return null;

  const local = farmLocal(now);
  const today = parseCalendarDate(local.date);
  if (!today) return null;
  const items = await farmBriefingToday(farmId, today);
  const plan = planFarmAlerts(items, await loadState(), local, now.getTime());
  if (!plan.send) { await saveState(plan.state); return null; }

  const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
  let base = "https://flockence.com/";
  try { base = new URL("/", process.env.APP_URL ?? "").href; } catch { /* default site */ }
  const email = farmAlertEmail(plan.items, farm?.name ?? "Your farm", new URL("/", base).href, base);

  let sent = 0, failed = 0;
  const stamp = plan.state.lastEmailAt ?? now.toISOString();
  for (const person of people) {
    const ok = await send(person.email, email, `flockence-farm-alert-${farmId}-${stamp}-${person.id}`.slice(0, 256), farmId).catch(() => false);
    if (ok) sent += 1; else failed += 1;
  }
  // Nobody reached: keep the old state so the next round tries again. Anyone reached: these items are done for today.
  if (sent) await saveState(plan.state);
  return { farmId, sent, items: plan.items.length, ...(failed ? { failed } : {}) };
}

/** Every farm. One farm's failure never stops the others. */
export async function runAllFarmAlerts(now = new Date()): Promise<FarmAlertResult[]> {
  const farms = await runUnscoped(() => prisma.farm.findMany({ select: { id: true } }));
  const results: FarmAlertResult[] = [];
  for (const { id } of farms) {
    const r = await runAsFarm(id, () => runFarmAlerts(now)).catch((error) => ({ farmId: id, sent: 0, skipped: `error: ${error instanceof Error ? error.name : "unknown"}` }));
    if (r) results.push(r);
  }
  return results;
}
