import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { recordInventoryMovement } from "@/lib/inventory-ledger";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.householdConsumption.findMany({ where: { batch: { farmId: currentFarmId() } }, orderBy: { date: "desc" }, include: { batch: true } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.product || !input.date || Number(input.quantity) <= 0) return NextResponse.json({ error: "Product, date and quantity are required." }, { status: 400 });
    const batch = input.batchId ? await prisma.batch.findFirst({ where: { id: input.batchId, farmId: currentFarmId() } }) : null;
    if (input.batchId && !batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    const quantity = Number(input.quantity);
    const weightKg = input.weightKg == null || input.weightKg === "" ? null : Number(input.weightKg);
    const estimatedValueMinor = Math.max(0, Number(input.estimatedValueMinor ?? 0));
    const record = await prisma.$transaction(async tx => {
      let inventoryId: string | null = input.inventoryItemId ? String(input.inventoryItemId) : null;
      if (!inventoryId) {
        const candidate = await tx.inventoryItem.findFirst({
          where: {
            product: { farmId: currentFarmId(), name: String(input.product).trim() },
            ...(batch?.id ? { batchId: batch.id } : {}),
            status: "AVAILABLE",
            quantity: { gte: quantity },
          },
          orderBy: { createdAt: "asc" },
        });
        inventoryId = candidate?.id ?? null;
      }
      if (inventoryId) {
        const deducted = await tx.inventoryItem.updateMany({
          where: { id: inventoryId, product: { farmId: currentFarmId() }, status: "AVAILABLE", quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (deducted.count !== 1) throw new Error("Inventory changed before household use could be recorded.");
      }

      const created = await tx.householdConsumption.create({
        data: {
          batchId: batch?.id,
          date: new Date(input.date),
          product: String(input.product).trim(),
          quantity,
          weightKg,
          estimatedValueMinor,
          cashReceivedMinor: 0,
        },
      });

      if (inventoryId) {
        const inventory = await tx.inventoryItem.findUnique({ where: { id: inventoryId }, select: { productId: true, batchId: true } });
        if (inventory) {
          await tx.inventoryItem.updateMany({ where: { id: inventoryId, quantity: 0 }, data: { status: "HOUSEHOLD" } });
          await recordInventoryMovement(tx, {
            farmId: currentFarmId(),
            inventoryItemId: inventoryId,
            productId: inventory.productId,
            batchId: batch?.id || inventory.batchId,
            date: new Date(input.date),
            movementType: "HOUSEHOLD",
            quantity,
            unit: String(input.unit || "each"),
            weightKg,
            referenceType: "HOUSEHOLD_CONSUMPTION",
            referenceId: created.id,
            notes: "Inventory consumed by household.",
          });
        }
      }
      return created;
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record household use." }, { status: 400 }); }
}
