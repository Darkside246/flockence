import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { accountPreferences } from "@/lib/account-preferences";
import { FARM_TIME_ZONE } from "@/lib/poultry-metrics.mjs";
import { sendVisionAlertEmail } from "@/lib/mail";
import { alertEmail, planAlerts, type AlertReason, type AlertState } from "@/lib/vision-alert-rules.mjs";
import type { RecordedFinding } from "@/lib/vision-findings";

/**
 * Vision alerts (Vision Intelligence phase 1c). After an inspection records its findings, serious ones (HIGH and
 * CRITICAL) are emailed at once to owners and managers who ticked "Farm alerts" on their Account page, grouped by
 * incident with a cooldown and an hourly limit (lib/vision-alert-rules.mjs). Each alert is also kept in a short log,
 * shown in Cameras → Vision, so an alert is visible even when nobody gets email.
 * Oriya / WhatsApp: automatic checks of cameras shared with Oriya already reach Oriya, which sends its own WhatsApp
 * alerts. Sending these Vision alerts to Oriya needs a new message type on Oriya's side (Phase 7), so not yet.
 */
const STATE_KEY = "VISION_ALERT_STATE";
const LOG_KEY = "VISION_ALERT_LOG";
const LOG_SIZE = 30;

export type AlertLogEntry = { at: string; held: boolean; emailed: number; findings: { id: string; title: string; severity: string; reason: AlertReason; place: string | null }[] };

async function readJson<T>(tx: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0], key: string): Promise<T | null> {
  const row = await tx.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key } }, select: { value: true } });
  try { return row ? JSON.parse(row.value) as T : null; } catch { return null; }
}

async function writeJson(tx: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0], key: string, data: unknown) {
  const farmId = currentFarmId(), value = JSON.stringify(data);
  await tx.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
}

export async function recentAlerts(): Promise<AlertLogEntry[]> {
  return (await readJson<AlertLogEntry[]>(prisma, LOG_KEY)) ?? [];
}

/** Send any alerts this inspection's findings call for. Never throws into the inspection. */
export async function alertOnFindings(findings: RecordedFinding[], now = new Date(), send = sendVisionAlertEmail) {
  if (!findings.some((f) => f.severity === "HIGH" || f.severity === "CRITICAL")) return null;
  const farmId = currentFarmId();
  // Decide and record under a per-farm lock, so two inspections finishing together cannot both alert the same incident.
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId + ":vision-alerts"}, 0))::text`;
    const before = await readJson<AlertState>(tx, STATE_KEY);
    const planned = planAlerts(findings, before, now.getTime());
    if (planned.send.length || planned.held) await writeJson(tx, STATE_KEY, planned.state);
    return { ...planned, before };
  }, { maxWait: 15_000, timeout: 15_000 });
  if (!plan.send.length && !plan.held) return null;

  let emailed = 0;
  if (plan.send.length) {
    const people = await prisma.user.findMany({ where: { farmId, role: { in: ["OWNER", "MANAGER"] } }, select: { id: true, email: true } });
    const wanting = [];
    for (const p of people) if ((await accountPreferences(farmId, p.id)).farmAlertEmail && !p.email.endsWith(".invalid")) wanting.push(p);
    if (wanting.length) {
      const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
      let link = "/vision";
      try { link = new URL("/vision", process.env.APP_URL ?? "").href; } catch { /* relative if APP_URL is unset */ }
      const when = new Intl.DateTimeFormat("en-GB", { timeZone: FARM_TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
      const email = alertEmail(plan.send, farm?.name ?? "Your farm", when, link);
      const key = `flockence-vision-alert-${farmId}-${plan.send.map((f) => f.id + f.reason).join("-")}-${now.getTime()}`.slice(0, 250);
      for (const p of wanting) if (await send(p.email, email, `${key}-${p.id}`.slice(0, 256), farmId).catch(() => false)) emailed += 1;
      if (!emailed) {
        // Nobody could be reached: put the state back, so the next inspection that sees it tries again.
        await writeJson(prisma, STATE_KEY, plan.before ?? { incidents: {}, sentAt: [] }).catch(() => undefined);
      }
    }
  }
  const entry: AlertLogEntry = {
    at: now.toISOString(), held: plan.held, emailed,
    findings: (plan.held ? findings.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL").map((f) => ({ ...f, reason: "NEW" as AlertReason })) : plan.send)
      .map((f) => ({ id: f.id, title: f.title, severity: f.severity, reason: f.reason, place: f.penName ?? f.cameraName ?? null })),
  };
  const log = await recentAlerts();
  await writeJson(prisma, LOG_KEY, [entry, ...log].slice(0, LOG_SIZE)).catch(() => undefined);
  return entry;
}
