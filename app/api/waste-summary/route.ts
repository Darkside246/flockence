import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calendarDateInTimeZone, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { wasteSummary } from "@/lib/waste-summary";

/** Waste and by-products over the last N days (default 30), from the records already kept. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const days = Math.min(366, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  const to = parseCalendarDate(calendarDateInTimeZone(new Date()) ?? "");
  if (!to) return NextResponse.json({ error: "Date unavailable." }, { status: 500 });
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const farmId = currentFarmId();
  return NextResponse.json(await prisma.$transaction(tx => wasteSummary(tx, farmId, from, to)));
}
