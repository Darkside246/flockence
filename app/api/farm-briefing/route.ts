import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calendarDateInTimeZone, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { farmBriefingToday } from "@/lib/farm-briefing";

/** The dashboard's "today on your farm": short sentences, most urgent first, each with what to do next. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const farmId = currentFarmId();
  const today = parseCalendarDate(calendarDateInTimeZone(new Date()) ?? "");
  if (!today) return NextResponse.json({ error: "Date unavailable." }, { status: 500 });
  const items = await farmBriefingToday(farmId, today);
  return NextResponse.json({ items });
}
