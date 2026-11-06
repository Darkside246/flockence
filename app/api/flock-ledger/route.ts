import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { loadFlockLedger } from "@/lib/flock-ledger";

/** How many birds a flock has on a date, and exactly how that number was worked out. Read-only. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const params = new URL(request.url).searchParams;
  const batchId = params.get("batchId");
  const dateText = params.get("date");
  const date = dateText ? parseCalendarDate(dateText) : null;
  if (!batchId) return NextResponse.json({ error: "Choose a flock." }, { status: 400 });
  if (dateText && !date) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const ledger = await prisma.$transaction(async tx => {
    const owned = await tx.batch.findFirst({ where: { id: batchId, farmId: currentFarmId() }, select: { id: true } });
    return owned ? loadFlockLedger(tx, batchId, date ?? undefined) : null;
  });
  if (!ledger) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  return NextResponse.json({ batchId, name: ledger.batch.name, date: dateText ?? null, everInFlock: ledger.everInFlock, ...ledger.balance });
}
