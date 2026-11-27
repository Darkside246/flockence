import { NextResponse } from "next/server";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { visionCameraRoles, visionCamerasEnabled, visionLiveEnabled } from "@/lib/vision-camera";
import { loadSchedule, saveSchedule } from "@/lib/vision-schedule";
import { currentVisionPlan } from "@/lib/vision-plan";
import { monthUsage } from "@/lib/vision-usage";
import { visionConfigured, visionModel, visionProvider } from "@/lib/vision-provider";
import {
  DEFAULTS, INTERVAL_HOURS, LIMITS, fitScheduleToPlan, inspectionsPerDay, normaliseSchedule, quietMinutes,
} from "@/lib/vision-schedule-rules.mjs";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** Automatic camera inspections: the farm's schedule, each camera's last result, and whether the server is ready. */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, visionCameraRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const [{ schedule, state }, plan, usage] = await Promise.all([loadSchedule(), currentVisionPlan(), monthUsage()]);
  const lastRound = state.lastRoundAt ? Date.parse(state.lastRoundAt) : NaN;
  return NextResponse.json({
    schedule: schedule ?? { enabled: false, cameras: {}, ...DEFAULTS },
    state: { day: state.day, runsToday: state.runsToday, lastRoundAt: state.lastRoundAt || null, cameras: state.cameras },
    perDay: inspectionsPerDay(schedule, quietMinutes(schedule?.quietStart ?? "", schedule?.quietEnd ?? "")),
    options: { intervals: INTERVAL_HOURS.filter((h) => h >= plan.limits.minIntervalHours), limits: LIMITS },
    plan: { name: plan.plan, label: plan.label, limits: plan.limits },
    usage: { month: usage.month, manual: usage.manual, automatic: usage.automatic, costUsd: Math.round(usage.costMicros / 10_000) / 100, unpricedCalls: usage.unpricedCalls },
    model: { provider: visionProvider(), name: visionModel() },
    ready: {
      vision: visionConfigured(),
      cameras: visionCamerasEnabled(),
      liveVideo: visionLiveEnabled(),
      // The timer runs every 10 minutes; no round in the last 30 means it is not installed or not running.
      timer: Number.isFinite(lastRound) && Date.now() - lastRound < 30 * 60_000,
    },
  }, { headers });
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, visionCameraRoles());
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const limit = await checkRateLimit("vision-schedule:" + session.user.farmId, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers });
  const checked = normaliseSchedule(await readAccountForm(request));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400, headers });
  const plan = await currentVisionPlan();
  const fitted = fitScheduleToPlan(checked.schedule, plan.limits, plan.label);
  if (!fitted.ok) return NextResponse.json({ error: fitted.error, code: "PLAN_LIMIT" }, { status: 403, headers });
  await saveSchedule(fitted.schedule, session.user.id);
  return NextResponse.json({ schedule: fitted.schedule }, { headers });
}
