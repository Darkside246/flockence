import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { farmFeatureAccess } from "@/lib/farm-feature-access";
import { oriyaBaseUrl } from "@/lib/oriya-farm-link";
import { farmStorage } from "@/lib/storage-quota";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const plan = await farmFeatureAccess().catch(() => ({ state: "UNAVAILABLE" as const, linked: false }));
  // Storage per plan (lib/storage-quota-rules.mjs); never blocks the plan answer.
  const storage = await farmStorage().catch(() => null);
  return NextResponse.json({
    ...plan, ...(plan.linked ? { subscriptionUrl: oriyaBaseUrl() } : {}),
    ...(storage ? { storage: { used: storage.used, limit: storage.limit, percent: storage.percent, level: storage.level, label: storage.label } } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
