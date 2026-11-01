import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const bagSizeKg = Number(input.bagSizeKg);
    const quantityBags = Number(input.quantityBags);
    const unitCostMinor = Number(input.unitCostMinor);
    if (!input.date || !String(input.feedType || "").trim() || !Number.isFinite(bagSizeKg) || bagSizeKg <= 0 || !Number.isFinite(quantityBags) || quantityBags <= 0 || !Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) {
      return NextResponse.json({ error: "Feed type, date, positive bag size, positive quantity and a valid non-negative cost are required." }, { status: 400 });
    }
    if (input.batchId) {
      const batch = await prisma.batch.findFirst({ where: { id: String(input.batchId), farmId: FARM_ID }, select: { id: true } });
      if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    if (input.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: String(input.supplierId), farmId: FARM_ID }, select: { id: true } });
      if (!supplier) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }
    const row = await prisma.feedPurchase.create({ data: { farmId: FARM_ID, batchId: input.batchId || null, date: new Date(input.date), feedType: String(input.feedType).trim(), bagSizeKg, quantityBags, unitCostMinor, supplierId: input.supplierId || null } });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid feed entry" }, { status: 400 });
  }
}
