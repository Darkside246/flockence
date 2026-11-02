import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batchId = new URL(request.url).searchParams.get("batchId");
  return NextResponse.json(await prisma.manureRecord.findMany({
    where: { farmId: currentFarmId(), ...(batchId ? { batchId } : {}) },
    orderBy: { date: "desc" },
    take: 200,
    include: { batch: true },
  }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const material = String(input.material || "Poultry litter").trim();
    const disposition = String(input.disposition || "STORED").trim().toUpperCase();
    const quantity = Number(input.quantity);
    if (!input.date || !Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: "Date and positive quantity are required." }, { status: 400 });
    if (input.batchId) {
      const batch = await prisma.batch.findFirst({ where: { id: String(input.batchId), farmId: currentFarmId() }, select: { id: true } });
      if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    const amountMinor = Number(input.amountMinor ?? 0);
    const transportMinor = Number(input.transportMinor ?? 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isSafeInteger(transportMinor) || transportMinor < 0) return NextResponse.json({ error: "Manure financial values are invalid." }, { status: 400 });
    const row = await prisma.manureRecord.create({
      data: {
        farmId: currentFarmId(),
        batchId: input.batchId || null,
        date: new Date(input.date),
        material,
        quantity,
        unit: String(input.unit || "kg"),
        disposition,
        amountMinor,
        transportMinor,
        notes: input.notes ? String(input.notes) : null,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record manure/litter." }, { status: 400 });
  }
}
