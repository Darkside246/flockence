import { NextResponse } from "next/server";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { visionCameraRoles, visionCamerasEnabled, visionLiveEnabled } from "@/lib/vision-camera";
import { loadSchedule, saveSchedule } from "@/lib/vision-schedule";
import {
  DEFAULTS, INTERVAL_HOURS, LIMITS, inspectionsPerDay, normaliseSchedule, quietMinutes,
} from "@/lib/vision-schedule-rules.mjs";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** Automatic camera inspections: the farm's schedule, each camera's last result, and whether the server is ready. */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, visionCameraRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const { schedule, state } = await loadSchedule();
  const lastRound = state.lastRoundAt ? Date.parse(state.lastRoundAt) : NaN;
  return NextResponse.json({
    schedule: schedule ?? { enabled: false, cameras: {}, ...DEFAULTS },
    state: { day: state.day, runsToday: state.runsToday, lastRoundAt: state.lastRoundAt || null, cameras: state.cameras },
    perDay: inspectionsPerDay(schedule, quietMinutes(schedule?.quietStart ?? "", schedule?.quietEnd ?? "")),
    options: { intervals: INTERVAL_HOURS, limits: LIMITS },
    ready: {
      vision: Boolean(process.env.OPENAI_API_KEY),
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
  await saveSchedule(checked.schedule, session.user.id);
  return NextResponse.json({ schedule: checked.schedule }, { headers });
}
