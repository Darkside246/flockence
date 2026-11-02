import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { getWithdrawalBlockers } from "@/lib/withdrawal";
import { recordInventoryMovement } from "@/lib/inventory-ledger";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.sale.findMany({ where: { farmId: currentFarmId() }, orderBy: { date: "desc" }, include: { items: true }, take: 100 }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.date || !Array.isArray(input.items) || !input.items.length) return NextResponse.json({ error: "Date and at least one sale item are required." }, { status: 400 });
    const saleDate = parseCalendarDate(input.date);
    if (!saleDate || !isCalendarDateNotFuture(saleDate)) {
      return NextResponse.json({ error: "Enter a valid current or historical sale date." }, { status: 400 });
    }
    const saleDayEnd = new Date(saleDate);
    saleDayEnd.setUTCDate(saleDayEnd.getUTCDate() + 1);
    if (input.externalId) { const existing = await prisma.sale.findFirst({ where: { farmId: currentFarmId(), externalId: String(input.externalId) }, include: { items: true } }); if (existing) return NextResponse.json(existing, { status: 200 }); }

    const items = input.items.map((item: any) => {
      const quantity = Number(item.quantity);
      const unitPriceMinor = Number(item.unitPriceMinor);
      const weightKg = item.weightKg == null || item.weightKg === "" ? null : Number(item.weightKg);
      return {
        batchId: item.batchId || null,
        inventoryItemId: item.inventoryItemId || null,
        description: String(item.description || "Chicken"),
        quantity,
        weightKg,
        unitPriceMinor,
        totalMinor: Math.round(quantity * unitPriceMinor)
      };
    });

    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0 || (item.weightKg !== null && (!Number.isFinite(item.weightKg) || item.weightKg < 0))) {
        return NextResponse.json({ error: "Sale quantities must be positive, prices cannot be negative, and weights must be valid." }, { status: 400 });
      }
      if (item.batchId) {
        const blockers = await getWithdrawalBlockers(String(item.batchId), saleDate);
        if (blockers.length) return NextResponse.json({ error: "SALE_BLOCKED_WITHDRAWAL", blockers }, { status: 409 });
      }
      if (item.inventoryItemId) {
        const inventory = await prisma.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, product: { farmId: currentFarmId() }, status: { in: ["AVAILABLE", "RESERVED"] } },
          select: { id: true, batchId: true, quantity: true },
        });
        if (!inventory || Number(inventory.quantity) < item.quantity) return NextResponse.json({ error: "Not enough inventory available for one of the sale items." }, { status: 409 });
        if (item.batchId && item.batchId !== inventory.batchId) {
          return NextResponse.json({ error: "The selected flock does not match the inventory lot." }, { status: 409 });
        }
        item.batchId = inventory.batchId;
        if (inventory.batchId) {
          const blockers = await getWithdrawalBlockers(inventory.batchId, saleDate);
          if (blockers.length) return NextResponse.json({ error: "SALE_BLOCKED_WITHDRAWAL", blockers }, { status: 409 });
        }
      } else if (item.batchId) {
        const batch = await prisma.batch.findFirst({ where: { id: item.batchId, farmId: currentFarmId() }, select: { id: true } });
        if (!batch) return NextResponse.json({ error: "Sale flock was not found in this farm." }, { status: 404 });
      }
    }

    const totalMinor = items.reduce((sum: number, item: any) => sum + item.totalMinor, 0);
    const requestedPaid = Number(input.amountPaidMinor ?? totalMinor);
    const amountPaidMinor = Number.isFinite(requestedPaid) ? Math.max(0, Math.min(totalMinor, Math.round(requestedPaid))) : 0;
    const paymentStatus = amountPaidMinor >= totalMinor ? "PAID" : amountPaidMinor > 0 ? "PARTIAL" : "UNPAID";

    const sale = await prisma.$transaction(async tx => {
      const sourceBatchIds = items.map((item: any) => item.batchId).filter((id: string | null) => Boolean(id));
      await lockFlockOperations(tx, sourceBatchIds);
      const blockers = await tx.treatment.findMany({
        where: {
          farmId: currentFarmId(),
          batchId: { in: sourceBatchIds },
          startedAt: { lt: saleDayEnd },
          OR: [
            { status: "ACTIVE", withdrawalClearsAt: null },
            { withdrawalClearsAt: { gt: saleDate } },
          ],
        },
        select: { batchId: true, productName: true, withdrawalClearsAt: true },
      });
      if (blockers.length > 0) {
        throw new Error("SALE_BLOCKED_WITHDRAWAL: A source flock has an uncleared treatment withdrawal.");
      }

      for (const item of items) if (item.inventoryItemId) {
        const result = await tx.inventoryItem.updateMany({
          where: { id: item.inventoryItemId, status: { in: ["AVAILABLE", "RESERVED"] }, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } }
        });
        if (result.count !== 1) throw new Error("Inventory changed before the sale could be completed.");
      }

      const created = await tx.sale.create({
        data: {
          farmId: currentFarmId(),
          date: saleDate,
          customerName: input.customerName || null,
          totalMinor,
          amountPaidMinor,
          paymentStatus,
          paymentMethod: input.paymentMethod || null,
          orderStatus: input.orderStatus || "COMPLETED",
          fulfillmentMethod: input.fulfillmentMethod || null,
          deliveryAddress: input.deliveryAddress || null,
          source: input.source || "MANUAL",
          externalId: input.externalId ? String(input.externalId) : null,
          items: { create: items }
        },
        include: { items: true }
      });

      for (const item of items) if (item.inventoryItemId) {
        await tx.inventoryItem.updateMany({ where: { id: item.inventoryItemId, quantity: 0 }, data: { status: "SOLD" } });
        const inventory = await tx.inventoryItem.findUnique({ where: { id: item.inventoryItemId }, select: { productId: true, batchId: true, product: { select: { unit: true } } } });
        if (inventory) {
          await recordInventoryMovement(tx, {
            farmId: currentFarmId(),
            inventoryItemId: item.inventoryItemId,
            productId: inventory.productId,
            batchId: item.batchId || inventory.batchId,
            date: saleDate,
            movementType: "SALE",
            quantity: item.quantity,
            unit: inventory.product?.unit || "each",
            weightKg: item.weightKg,
            referenceType: "SALE",
            referenceId: created.id,
            notes: "Inventory deducted by sale.",
          });
        }
      }
      return created;
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid sale";
    return NextResponse.json({ error: message.replace("SALE_BLOCKED_WITHDRAWAL: ", "") }, { status: message.includes("SALE_BLOCKED_WITHDRAWAL") ? 409 : 400 });
  }
}
