import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { parseCalendarDate, calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
import { liveWeightFromOutput, planSlaughter } from "@/lib/slaughter-intelligence";

/**
 * GET ?batchId&birds&date&storageLocationId[&definition] : the pre-slaughter check (birds, age, expected meat, storage)
 * GET ?slaughterEventId                                  : average live weight, weighed or worked back from output
 */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const q = new URL(request.url).searchParams;
  const farmId = currentFarmId();
  const eventId = q.get("slaughterEventId");
  if (eventId) return NextResponse.json(await prisma.$transaction(tx => liveWeightFromOutput(tx, farmId, eventId)));
  const batchId = q.get("batchId");
  const birds = Number(q.get("birds"));
  const date = parseCalendarDate(q.get("date") || calendarDateInTimeZone(new Date()) || "");
  const definition = q.get("definition") === "CARCASS_WITH_GIBLETS" ? "CARCASS_WITH_GIBLETS" : "CARCASS";
  if (!batchId || !date || !Number.isSafeInteger(birds) || birds < 1) return NextResponse.json({ error: "Choose the flock, a date and how many birds." }, { status: 400 });
  const owned = await prisma.batch.findFirst({ where: { id: batchId, farmId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  const result = await prisma.$transaction(tx => planSlaughter(tx, farmId, { batchId, birds, date, storageLocationId: q.get("storageLocationId"), definition }));
  return NextResponse.json(result);
}
