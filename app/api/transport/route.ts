import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, FARM_ID } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.transportationExpense.findMany({ where: { farmId: FARM_ID }, orderBy: { date: "desc" }, include: { batch: true } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.date || !input.purpose) return NextResponse.json({ error: "Date and purpose are required." }, { status: 400 });
    const batch = input.batchId ? await prisma.batch.findFirst({ where: { id: input.batchId, farmId: FARM_ID } }) : null;
    if (input.batchId && !batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    const row = await prisma.transportationExpense.create({ data: { farmId: FARM_ID, batchId: batch?.id, date: new Date(input.date), purpose: input.purpose, distanceKm: input.distanceKm ?? null, fuelMinor: Math.max(0, input.fuelMinor ?? 0), otherMinor: Math.max(0, input.otherMinor ?? 0), actualCashMinor: Math.max(0, input.actualCashMinor ?? 0), economicMinor: Math.max(0, input.economicMinor ?? input.actualCashMinor ?? 0), allocationMethod: input.allocationMethod || "FARM_WIDE", allocationPercent: input.allocationPercent ?? null } });
    return NextResponse.json(row, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record transport." }, { status: 400 }); }
}
