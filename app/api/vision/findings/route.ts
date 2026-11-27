import { NextResponse } from "next/server";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { listFindings, reviewVisionFinding } from "@/lib/vision-findings";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** Vision findings for this farm: open ones by default (?all=1 for every state), optionally one pen. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  // Every plan, Free included (owner, 2026-11-27): findings, reports and the timeline cost nothing to read.
  const url = new URL(request.url);
  const penId = url.searchParams.get("penId");
  const findings = await listFindings({ open: url.searchParams.get("all") !== "1", penId: penId && /^[A-Za-z0-9_-]{1,64}$/.test(penId) ? penId : undefined });
  return NextResponse.json({ findings }, { headers });
}

/** A person confirms, dismisses or resolves a finding. Read-only accounts cannot. Official records are never changed. */
export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER", "WORKER"]);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const limit = await checkRateLimit("vision-finding:" + session.user.farmId, 60, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers });
  const data = await readAccountForm(request);
  const id = typeof data?.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.id) ? data.id : null;
  if (!id) return NextResponse.json({ error: "Choose a finding." }, { status: 400, headers });
  const result = await reviewVisionFinding(id, { state: typeof data?.state === "string" ? data.state : undefined, note: data?.note }, { id: session.user.id, name: session.user.name });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers });
  return NextResponse.json({ finding: result.finding }, { headers });
}
