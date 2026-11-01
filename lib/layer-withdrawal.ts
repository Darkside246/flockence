import type { Prisma } from "@prisma/client";
import { recordInventoryMovement } from "@/lib/inventory-ledger";

type WithdrawalCondemnationInput = {
  farmId: string;
  batchId: string;
  fromDate: Date;
  toDate?: Date | null;
  reason: string;
  actorUserId?: string | null;
  treatmentId?: string | null;
};

/**
 * Eggs laid/collected inside a medicine withdrawal window are permanently
 * non-saleable. Any carton lot that consumed those eggs is condemned too.
 * This is deliberately not an automatic release workflow.
 */
export async function condemnLayerEggLotsForWithdrawal(
  tx: Prisma.TransactionClient,
  input: WithdrawalCondemnationInput,
) {
  const fromDay = new Date(input.fromDate);
  fromDay.setUTCHours(0, 0, 0, 0);

  const collections = await tx.eggCollection.findMany({
    where: {
      farmId: input.farmId,
      batchId: input.batchId,
      date: {
        gte: fromDay,
        ...(input.toDate ? { lt: input.toDate } : {}),
      },
    },
    include: {
      grades: {
        include: { inventoryItem: { include: { product: true } } },
      },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const sourceInventoryIds = new Set<string>();
  const now = new Date();
  let condemnedEggs = 0;
  const newlyCondemnedInventoryIds = new Set<string>();

  for (const collection of collections) {
    for (const grade of collection.grades) {
      const inventory = grade.inventoryItem;
      if (!inventory) continue;
      sourceInventoryIds.add(inventory.id);
      const quantity = Number(inventory.quantity);
      if (inventory.status !== "DISPOSED" || quantity !== 0) {
        newlyCondemnedInventoryIds.add(inventory.id);
        await tx.inventoryItem.update({
          where: { id: inventory.id },
          data: { quantity: 0, status: "DISPOSED" },
        });
        if (quantity > 0) {
          condemnedEggs += quantity;
          await recordInventoryMovement(tx, {
            farmId: input.farmId,
            inventoryItemId: inventory.id,
            productId: inventory.productId,
            batchId: input.batchId,
            date: now,
            movementType: "DISPOSAL",
            quantity,
            unit: "egg",
            referenceType: "EGG_WITHDRAWAL",
            referenceId: input.treatmentId || collection.id,
            notes: input.reason,
          });
        }
      }
    }

    await tx.eggCollection.update({
      where: { id: collection.id },
      data: {
        withdrawalBlocked: true,
        withdrawalNotes: input.reason.slice(0, 1000),
      },
    });
    await tx.auditLog.create({
      data: {
        farmId: input.farmId,
        userId: input.actorUserId || null,
        action: "LAYER_EGGS_CONDEMNED_FOR_WITHDRAWAL",
        entity: "EggCollection",
        entityId: collection.id,
        afterJson: JSON.stringify({
          treatmentId: input.treatmentId || null,
          batchId: input.batchId,
          reason: input.reason,
        }),
      },
    });
  }

  if (sourceInventoryIds.size === 0) {
    return { collections: collections.length, sourceLots: 0, condemnedEggs, condemnedCartons: 0 };
  }

  const packInputs = await tx.eggPackInput.findMany({
    where: {
      inventoryItemId: { in: [...sourceInventoryIds] },
      packRun: { farmId: input.farmId },
    },
    include: {
      packRun: {
        include: {
          outputInventoryItem: { include: { product: true } },
        },
      },
    },
  });
  const affectedRuns = new Map(packInputs.map((row) => [row.packRun.id, row.packRun]));
  let condemnedCartons = 0;

  for (const run of affectedRuns.values()) {
    const output = run.outputInventoryItem;
    if (!output) continue;
    const quantity = Number(output.quantity);
    if (output.status === "DISPOSED" && quantity === 0) continue;

    newlyCondemnedInventoryIds.add(output.id);
    await tx.inventoryItem.update({
      where: { id: output.id },
      data: { quantity: 0, status: "DISPOSED" },
    });
    if (quantity > 0) {
      condemnedCartons += quantity;
      await recordInventoryMovement(tx, {
        farmId: input.farmId,
        inventoryItemId: output.id,
        productId: output.productId,
        batchId: output.batchId,
        date: now,
        movementType: "DISPOSAL",
        quantity,
        unit: output.product.unit || "carton",
        referenceType: "EGG_WITHDRAWAL",
        referenceId: input.treatmentId || run.id,
        notes: "Cartons condemned because at least one source egg lot was inside a medication withdrawal period. " + input.reason,
      });
    }
    await tx.auditLog.create({
      data: {
        farmId: input.farmId,
        userId: input.actorUserId || null,
        action: "EGG_CARTON_CONDEMNED_FOR_WITHDRAWAL",
        entity: "EggPackRun",
        entityId: run.id,
        afterJson: JSON.stringify({
          treatmentId: input.treatmentId || null,
          packCode: run.packCode,
          reason: input.reason,
        }),
      },
    });
  }

  let potentialAffectedSales = 0;
  let reviewTaskCreated = false;
  if (newlyCondemnedInventoryIds.size > 0) {
    const affectedSales = await tx.saleItem.findMany({
      where: { inventoryItemId: { in: [...newlyCondemnedInventoryIds] } },
      include: { sale: true },
      orderBy: { sale: { date: "desc" } },
      take: 100,
    });
    potentialAffectedSales = affectedSales.length;
    if (affectedSales.length > 0) {
      const saleDetails = affectedSales.map((item) =>
        `Sale ${item.sale.id} dated ${item.sale.date.toISOString()} - ${item.description}, quantity ${item.quantity}, customer ${item.sale.customerName || "not recorded"}`
      );
      const task = await tx.farmTask.create({
        data: {
          farmId: input.farmId,
          batchId: input.batchId,
          title: "URGENT: Review sales affected by egg medication withdrawal",
          description: [
            input.reason,
            "Potentially affected sales were found for egg or carton lots condemned after this withdrawal was recorded.",
            ...saleDetails,
            "Review the treatment record, sale records and affected customers. Follow the farm's approved food-safety withdrawal and recall procedure.",
          ].join("\n").slice(0, 8000),
          priority: "URGENT",
          dueAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          farmId: input.farmId,
          userId: input.actorUserId || null,
          action: "EGG_WITHDRAWAL_SALE_REVIEW_REQUIRED",
          entity: "FarmTask",
          entityId: task.id,
          afterJson: JSON.stringify({
            treatmentId: input.treatmentId || null,
            sourceInventoryIds: [...newlyCondemnedInventoryIds],
            affectedSales: affectedSales.length,
          }),
        },
      });
      reviewTaskCreated = true;
    }
  }

  return {
    collections: collections.length,
    sourceLots: sourceInventoryIds.size,
    condemnedEggs,
    condemnedCartons,
    potentialAffectedSales,
    reviewTaskCreated,
  };
}
