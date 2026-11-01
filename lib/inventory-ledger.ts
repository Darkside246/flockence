import type { Prisma } from "@prisma/client";

export async function recordInventoryMovement(
  tx: Prisma.TransactionClient,
  input: {
    farmId: string;
    inventoryItemId?: string | null;
    productId?: string | null;
    batchId?: string | null;
    date?: Date;
    movementType: "PRODUCTION" | "RECEIPT" | "SALE" | "HOUSEHOLD" | "ADJUSTMENT" | "PACKING" | "DAMAGE" | "DISPOSAL" | "RESERVATION" | "RELEASE";
    quantity: number;
    unit: string;
    weightKg?: number | null;
    referenceType?: string | null;
    referenceId?: string | null;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    notes?: string | null;
  },
) {
  return tx.inventoryMovement.create({
    data: {
      farmId: input.farmId,
      inventoryItemId: input.inventoryItemId ?? null,
      productId: input.productId ?? null,
      batchId: input.batchId ?? null,
      date: input.date ?? new Date(),
      movementType: input.movementType,
      quantity: input.quantity,
      unit: input.unit,
      weightKg: input.weightKg ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      fromLocationId: input.fromLocationId ?? null,
      toLocationId: input.toLocationId ?? null,
      notes: input.notes ?? null,
    },
  });
}
