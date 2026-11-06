import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calendarDateInTimeZone, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { flockInsights } from "@/lib/flock-insights";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const q = new URL(request.url).searchParams;
  const batchId = q.get("batchId");
  if (!batchId) return NextResponse.json({ error: "Choose a flock." }, { status: 400 });
  const today = parseCalendarDate(calendarDateInTimeZone(new Date()) ?? "");
  const heat = Number(q.get("heatAboveC"));
  const farmId = currentFarmId();
  const owned = await prisma.batch.findFirst({ where: { id: batchId, farmId }, select: { id: true } });
  if (!owned || !today) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  return NextResponse.json(await prisma.$transaction(tx => flockInsights(tx, farmId, batchId, today, { heatAboveC: Number.isFinite(heat) && heat > 0 ? heat : undefined, bandC: Number(q.get("bandC")) > 0 ? Number(q.get("bandC")) : undefined })));
}
