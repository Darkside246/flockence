import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { buildVisionReport, periodFor, type ReportScope } from "@/lib/vision-reports";
import { validVisionCameraName } from "@/lib/vision-camera";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const idOk = (v: string | null): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/**
 * A Vision report built from records already held (no new picture analysis, so no cost):
 * ?scope=farm|pen|batch|camera &id= (pen or batch id) &camera= (camera name)
 * &period=today|24h|7d|30d|batch|custom &from=YYYY-MM-DD &to=YYYY-MM-DD
 */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  // Every plan, Free included (owner, 2026-11-27): findings, reports and the timeline cost nothing to read.
  const limit = await checkRateLimit("vision-report:" + session.user.farmId, 60, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many reports at once. Try again shortly." }, { status: 429, headers });
  const url = new URL(request.url);
  const kind = url.searchParams.get("scope") ?? "farm";
  let scope: ReportScope;
  if (kind === "pen" && idOk(url.searchParams.get("id"))) scope = { kind: "PEN", id: url.searchParams.get("id")! };
  else if (kind === "batch" && idOk(url.searchParams.get("id"))) scope = { kind: "BATCH", id: url.searchParams.get("id")! };
  else if (kind === "camera" && validVisionCameraName(url.searchParams.get("camera"))) scope = { kind: "CAMERA", name: url.searchParams.get("camera")! };
  else if (kind === "farm") scope = { kind: "FARM" };
  else return NextResponse.json({ error: "Choose the farm, a pen, a batch or a camera." }, { status: 400, headers });

  const periodName = url.searchParams.get("period") ?? "7d";
  const batchStart = scope.kind === "BATCH" && periodName === "batch"
    ? (await prisma.batch.findFirst({ where: { id: scope.id, farmId: currentFarmId() }, select: { startDate: true } }))?.startDate ?? null : null;
  const period = periodFor(periodName, new Date(), { from: url.searchParams.get("from"), to: url.searchParams.get("to") }, batchStart);
  if (!period) return NextResponse.json({ error: "Choose a period (a custom range can be up to 400 days)." }, { status: 400, headers });
  const report = await buildVisionReport(scope, period);
  if (!report) return NextResponse.json({ error: "Not found." }, { status: 404, headers });
  return NextResponse.json({ report }, { headers });
}
