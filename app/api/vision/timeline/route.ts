import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { penTimeline } from "@/lib/vision-findings";
import { visionPens } from "@/lib/vision-pens";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** One pen's Vision history in date order (inspections, findings, reviews). ?penId=&days=30 (up to 400). */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const url = new URL(request.url);
  const penId = url.searchParams.get("penId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(penId) || !(await visionPens(penId))[0]) return NextResponse.json({ error: "Choose a pen." }, { status: 400, headers });
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
  return NextResponse.json({ entries: await penTimeline(penId, from, to) }, { headers });
}
