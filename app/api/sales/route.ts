import { createHash } from "node:crypto";
import { z } from "zod";
import { offlineEventId } from "@/lib/offline-event";
import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { getWithdrawalBlockers } from "@/lib/withdrawal";
import { recordInventoryMovement } from "@/lib/inventory-ledger";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

const offlineSale = z.strictObject({
  date: z.string(),
  currency: z.string().length(3),
  customerName: z.string().trim().max(120),
  amountPaidMinor: z.number().int().min(0).max(2147483647),
  items: z.tuple([z.strictObject({
    inventoryItemId: z.string().min(1).max(128),
    quantity: z.number().gt(0).max(999999999).refine(value => Number(value.toFixed(3)) === value),
    unitPriceMinor: z.number().int().min(0).max(2147483647),
  })]),
  offline: z.unknown(),
});

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.sale.findMany({ where: { farmId: currentFarmId() }, orderBy: { date: "desc" }, include: { items: true }, take: 100 }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const syncId = input.offline === undefined ? undefined : offlineEventId(request, input.offline, session.user);
    if (syncId === null) return NextResponse.json({ error: "Sign in as the original farm account to confirm this draft." }, { status: 403 });
    const checked = syncId ? offlineSale.safeParse(input) : null;
    if (checked && !checked.success) return NextResponse.json({ error: "Check the offline sale details." }, { status: 400 });
    const draft = checked?.data;
    const farmId = currentFarmId();
    const receiptKey = syncId ? "OFFLINE_SALE_RECEIPT::" + syncId : null;
    const payloadHash = draft ? createHash("sha256").update(JSON.stringify([
      draft.date, draft.currency, draft.customerName, draft.amountPaidMinor, draft.items,
    ])).digest("hex") : null;
    if (receiptKey) {
      const receipt = await prisma.setting.findUnique({ where: { farmId_key: { farmId, key: receiptKey } } });
      if (receipt) {
        if (receipt.value !== payloadHash) throw new Error("OFFLINE_SALE_CONFLICT: This sale already synced with different details.");
        return NextResponse.json({ id: syncId }, { status: 200 });
      }
    }
    if (!input.date || !Array.isArray(input.items) || !input.items.length) return NextResponse.json({ error: "Date and at least one sale item are required." }, { status: 400 });
    const saleDate = parseCalendarDate(input.date);
    if (!saleDate || !isCalendarDateNotFuture(saleDate)) {
      return NextResponse.json({ error: "Enter a valid current or historical sale date." }, { status: 400 });
    }
    const saleDayEnd = new Date(saleDate);
    saleDayEnd.setUTCDate(saleDayEnd.getUTCDate() + 1);
    if (input.externalId) { const existing = await prisma.sale.findFirst({ where: { farmId: currentFarmId(), externalId: String(input.externalId) }, include: { items: true } }); if (existing) return NextResponse.json(existing, { status: 200 }); }

    const items = (draft?.items ?? input.items).map((item: any) => {
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
          where: { id: item.inventoryItemId, product: { farmId }, ...(!draft ? { status: { in: ["AVAILABLE", "RESERVED"] } } : {}) },
          select: { id: true, batchId: true, quantity: true, product: { select: { name: true } } },
        });
        if (!inventory || (draft ? !inventory.batchId : Number(inventory.quantity) < item.quantity)) return NextResponse.json({ error: "Not enough inventory available for one of the sale items." }, { status: 409 });
        if (item.batchId && item.batchId !== inventory.batchId) {
          return NextResponse.json({ error: "The selected flock does not match the inventory lot." }, { status: 409 });
        }
        item.batchId = inventory.batchId;
        if (draft) item.description = inventory.product.name;
        if (inventory.batchId && !draft) {
          const blockers = await getWithdrawalBlockers(inventory.batchId, saleDate);
          if (blockers.length) return NextResponse.json({ error: "SALE_BLOCKED_WITHDRAWAL", blockers }, { status: 409 });
        }
      } else if (item.batchId) {
        const batch = await prisma.batch.findFirst({ where: { id: item.batchId, farmId: currentFarmId() }, select: { id: true } });
        if (!batch) return NextResponse.json({ error: "Sale flock was not found in this farm." }, { status: 404 });
      }
    }

    const totalMinor = items.reduce((sum: number, item: any) => sum + item.totalMinor, 0);
    if (draft && (!Number.isSafeInteger(totalMinor) || totalMinor > 2147483647 || draft.amountPaidMinor > totalMinor)) {
      return NextResponse.json({ error: "Check the sale total and payment amount." }, { status: 400 });
    }
    const requestedPaid = Number(input.amountPaidMinor ?? totalMinor);
    const amountPaidMinor = Number.isFinite(requestedPaid) ? Math.max(0, Math.min(totalMinor, Math.round(requestedPaid))) : 0;
    const paymentStatus = amountPaidMinor >= totalMinor ? "PAID" : amountPaidMinor > 0 ? "PARTIAL" : "UNPAID";

    const sale = await prisma.$transaction(async tx => {
      if (receiptKey) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))::text`;
        const receipt = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: receiptKey } } });
        if (receipt) {
          if (receipt.value !== payloadHash) throw new Error("OFFLINE_SALE_CONFLICT: This sale already synced with different details.");
          return { id: syncId };
        }
      }
      if (draft) {
        const farm = await tx.farm.findUniqueOrThrow({ where: { id: farmId }, select: { currency: true } });
        if (draft.currency !== farm.currency) throw new Error("OFFLINE_SALE_CONFLICT: The farm currency changed. Review this draft online.");
      }
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
          where: {
            id: item.inventoryItemId, status: { in: draft ? ["AVAILABLE"] : ["AVAILABLE", "RESERVED"] },
            quantity: { gte: item.quantity },
            ...(draft ? { batchId: item.batchId, OR: [{ useByDate: null }, { useByDate: { gte: saleDate } }] } : {}),
          },
          data: { quantity: { decrement: item.quantity } }
        });
        if (result.count !== 1) throw new Error(draft ? "OFFLINE_SALE_CONFLICT: Stock is unavailable, expired, or traceability changed. Review the draft online." : "Inventory changed before the sale could be completed.");
      }

      const created = await tx.sale.create({
        data: {
          ...(syncId ? { id: syncId } : {}), farmId,
          date: saleDate,
          customerName: (draft?.customerName ?? input.customerName) || null,
          totalMinor,
          amountPaidMinor,
          paymentStatus,
          paymentMethod: input.paymentMethod || null,
          orderStatus: input.orderStatus || "COMPLETED",
          fulfillmentMethod: input.fulfillmentMethod || null,
          deliveryAddress: input.deliveryAddress || null,
          source: draft ? "OFFLINE" : input.source || "MANUAL",
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
      if (receiptKey && payloadHash) {
        await tx.setting.create({ data: { farmId, key: receiptKey, value: payloadHash } });
      }
      return created;
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid sale";
    const conflict = /^(SALE_BLOCKED_WITHDRAWAL|OFFLINE_SALE_CONFLICT):/.test(message);
    return NextResponse.json({ error: message.replace(/^(SALE_BLOCKED_WITHDRAWAL|OFFLINE_SALE_CONFLICT): /, "") }, { status: conflict ? 409 : 400 });
  }
}
