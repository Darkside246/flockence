import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { farmFeatureAccess } from "@/lib/farm-feature-access";
import { oriyaBaseUrl } from "@/lib/oriya-farm-link";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const plan = await farmFeatureAccess().catch(() => ({ state: "UNAVAILABLE" as const, linked: false }));
  return NextResponse.json({
    ...plan, ...(plan.linked ? { subscriptionUrl: oriyaBaseUrl() } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
