import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calendarDateInTimeZone, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { farmBriefing } from "@/lib/farm-briefing";

/** The dashboard's "today on your farm": short sentences, most urgent first, each with what to do next. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const farmId = currentFarmId();
  const today = parseCalendarDate(calendarDateInTimeZone(new Date()) ?? "");
  if (!today) return NextResponse.json({ error: "Date unavailable." }, { status: 500 });
  const items = await prisma.$transaction(async tx => {
    // Broiler-only farms see no egg lines and layer-only farms no slaughter-age lines, judged from the active flocks.
    const active = await tx.batch.findMany({ where: { farmId, status: "ACTIVE" }, select: { productionType: true, species: true } });
    const layers = active.filter(b => b.productionType === "LAYER" || String(b.species).toUpperCase() === "LAYER").length;
    const op = active.length && !layers ? "broilers" : active.length && layers === active.length ? "layers" : null;
    return farmBriefing(tx, farmId, today, op);
  });
  return NextResponse.json({ items });
}
