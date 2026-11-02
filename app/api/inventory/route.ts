import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { recordInventoryMovement } from "@/lib/inventory-ledger";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.inventoryItem.findMany({ where: { product: { farmId: currentFarmId() } }, include: { product: true, batch: true, storageLocation: true }, orderBy: { createdAt: "desc" } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const x = await request.json();
    const quantity = Number(x.quantity);
    const weightKg = x.weightKg == null || x.weightKg === "" ? null : Number(x.weightKg);
    const priceMinor = x.priceMinor == null || x.priceMinor === "" ? null : Number(x.priceMinor);
    const costBasisMinor = x.costBasisMinor == null || x.costBasisMinor === "" ? 0 : Number(x.costBasisMinor);
    if (!x.product || !Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: "Product and a positive quantity are required." }, { status: 400 });
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0)) return NextResponse.json({ error: "Weight must be zero or greater." }, { status: 400 });
    if (priceMinor !== null && (!Number.isSafeInteger(priceMinor) || priceMinor < 0)) return NextResponse.json({ error: "Selling price must be a valid non-negative amount." }, { status: 400 });
    if (!Number.isSafeInteger(costBasisMinor) || costBasisMinor < 0) return NextResponse.json({ error: "Cost basis must be a valid non-negative amount." }, { status: 400 });

    const p = await prisma.product.upsert({
      where: { farmId_name: { farmId: currentFarmId(), name: String(x.product).trim() } },
      update: {},
      create: { farmId: currentFarmId(), name: String(x.product).trim(), unit: String(x.unit || "each"), defaultPriceMinor: priceMinor }
    });
    const row = await prisma.$transaction(async tx => {
      const inventory = await tx.inventoryItem.create({
        data: {
          productId: p.id,
          batchId: x.batchId || null,
          quantity,
          weightKg,
          costBasisMinor,
          sellingPriceMinor: priceMinor,
          storageLocationId: x.storageLocationId || null,
          lotCode: x.lotCode ? String(x.lotCode) : null,
          packedAt: x.packedAt ? new Date(x.packedAt) : null,
          useByDate: x.useByDate ? new Date(x.useByDate) : null,
          storageState: x.storageState ? String(x.storageState).toUpperCase() : null,
        }
      });
      await recordInventoryMovement(tx, {
        farmId: currentFarmId(),
        inventoryItemId: inventory.id,
        productId: p.id,
        batchId: x.batchId || null,
        movementType: "RECEIPT",
        quantity,
        unit: String(x.unit || p.unit),
        weightKg,
        referenceType: "INVENTORY_RECEIPT",
        referenceId: inventory.id,
        toLocationId: x.storageLocationId || null,
        notes: x.notes ? String(x.notes) : null,
      });
      return inventory;
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid inventory" }, { status: 400 });
  }
}
