import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { ensureFarm, FARM_ID } from "@/lib/operations";
import { getWithdrawalBlockers } from "@/lib/withdrawal";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const searchParams = new URL(request.url).searchParams;
  const batchId = searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });
  const dateParam = searchParams.get("date");
  const effectiveDate = dateParam
    ? parseCalendarDate(dateParam)
    : parseCalendarDate(new Date().toISOString().slice(0, 10));
  if (!effectiveDate || !isCalendarDateNotFuture(effectiveDate)) {
    return NextResponse.json({ error: "date must be a valid current or historical calendar date." }, { status: 400 });
  }
  const blockers = await getWithdrawalBlockers(batchId, effectiveDate);
  return NextResponse.json({
    farmId: FARM_ID,
    batchId,
    blocked: blockers.length > 0,
    blockers,
  });
}
