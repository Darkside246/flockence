import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { currentVisionPlan } from "@/lib/vision-plan";
import { monthUsage } from "@/lib/vision-usage";
import { farmStorage } from "@/lib/storage-quota";

export const runtime = "nodejs";

/** The farm's Vision plan and how many photo checks are left this month (shown beside "Check my flock"). */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const [plan, usage, storage] = await Promise.all([currentVisionPlan(), monthUsage(), farmStorage().catch(() => null)]);
  return NextResponse.json({
    plan: plan.plan, label: plan.label, manualPerMonth: plan.limits.manualPerMonth, used: usage.manual,
    left: Math.max(0, plan.limits.manualPerMonth - usage.manual), cameras: plan.limits.maxCameras > 0,
    ...(storage ? { storage: { used: storage.used, limit: storage.limit, percent: storage.percent, level: storage.level } } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
