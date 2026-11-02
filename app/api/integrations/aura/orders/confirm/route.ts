import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { authorizeAuraIntegration, readAuraQuote } from "@/lib/aura-integration";
import { recordInventoryMovement } from "@/lib/inventory-ledger";
import { lockFlockOperations } from "@/lib/poultry-lock";

export async function POST(request: Request) {
  if (!authorizeAuraIntegration(request)) return NextResponse.json({ error: "INVALID_INTEGRATION_TOKEN" }, { status: 401 });
  try {
    await ensureFarm();
    const input = await request.json();
    const quoteToken = String(input.quoteToken || "");
    const idempotencyKey = String(input.idempotencyKey || "").trim();
    const customerPhone = String(input.customerPhone || "").trim();
    const customerName = String(input.customerName || "").trim() || "WhatsApp customer";
    const deliveryAddress = String(input.deliveryAddress || "").trim() || null;
    if (!quoteToken || !idempotencyKey || !customerPhone) return NextResponse.json({ error: "quoteToken, idempotencyKey and customerPhone are required." }, { status: 400 });
    const quote = readAuraQuote<any>(quoteToken);
    if (!quote || quote.v !== 1 || quote.farmId !== currentFarmId() || Number(quote.expiresAt) < Date.now()) return NextResponse.json({ error: "QUOTE_EXPIRED_OR_INVALID" }, { status: 409 });
    const fulfillmentMethod = String(quote.fulfillmentMethod);
    if (fulfillmentMethod === "DELIVERY" && !deliveryAddress) return NextResponse.json({ error: "CONFIRMED_DELIVERY_ADDRESS_REQUIRED" }, { status: 400 });

    const existing = await prisma.sale.findFirst({ where: { farmId: currentFarmId(), externalId: idempotencyKey }, include: { items: true } });
    if (existing) return NextResponse.json({ order: existing, deduplicated: true });

    const result = await prisma.$transaction(async (tx) => {
      const byPhone = await tx.customer.findFirst({ where: { farmId: currentFarmId(), phone: customerPhone } });
      let customerId: string;
      if (byPhone) {
        customerId = byPhone.id;
        if (customerName && byPhone.name === "WhatsApp customer") await tx.customer.update({ where: { id: byPhone.id }, data: { name: customerName } });
      } else {
        customerId = (await tx.customer.create({ data: { farmId: currentFarmId(), name: customerName, phone: customerPhone } })).id;
      }
      const sourceBatchIds = new Set<string>();
      for (const line of quote.lines as any[]) {
        const inventory = await tx.inventoryItem.findFirst({
          where: { id: line.inventoryItemId, product: { farmId: currentFarmId() }, status: "AVAILABLE" },
          select: { id: true, batchId: true, productId: true },
        });
        if (!inventory) throw new Error("Inventory changed before the order could be completed.");
        const batchId = line.batchId || inventory.batchId;
        if (batchId) sourceBatchIds.add(batchId);
      }

      if (sourceBatchIds.size > 0) {
        await lockFlockOperations(tx, [...sourceBatchIds]);
        const blockers = await tx.treatment.findMany({
          where: {
            farmId: currentFarmId(),
            batchId: { in: [...sourceBatchIds] },
            OR: [
              { status: "ACTIVE", withdrawalClearsAt: null },
              { withdrawalClearsAt: { gt: new Date() } },
            ],
          },
          select: { batchId: true, productName: true, withdrawalClearsAt: true },
        });
        if (blockers.length > 0) {
          const products = [...new Set(blockers.map((row) => row.productName))].join(", ");
          throw new Error(`SALE_BLOCKED_WITHDRAWAL: The selected stock is linked to a flock with an uncleared treatment withdrawal: ${products}.`);
        }
      }

      for (const line of quote.lines as any[]) {
        const updated = await tx.inventoryItem.updateMany({ where: { id: line.inventoryItemId, product: { farmId: currentFarmId() }, status: "AVAILABLE", quantity: { gte: Number(line.quantity) } }, data: { quantity: { decrement: Number(line.quantity) } } });
        if (updated.count !== 1) throw new Error("Inventory changed before the order could be completed.");
      }
      const created = await tx.sale.create({
        data: {
          farmId: currentFarmId(), date: new Date(), customerId, customerName,
          totalMinor: Number(quote.totalMinor), amountPaidMinor: 0, paymentStatus: "UNPAID",
          recordStatus: "ACTUAL", orderStatus: "CONFIRMED", fulfillmentMethod, deliveryAddress,
          source: "AURA_WHATSAPP", externalId: idempotencyKey,
          items: { create: (quote.lines as any[]).map((line) => ({ batchId: line.batchId || null, inventoryItemId: line.inventoryItemId, description: line.productName, quantity: Number(line.quantity), unitPriceMinor: Number(line.unitPriceMinor), totalMinor: Number(line.totalMinor) })) },
        },
        include: { items: true },
      });
      for (const line of quote.lines as any[]) {
        await tx.inventoryItem.updateMany({
          where: { id: line.inventoryItemId, quantity: 0 },
          data: { status: "SOLD" },
        });
        const inventory = await tx.inventoryItem.findFirst({
          where: { id: line.inventoryItemId, product: { farmId: currentFarmId() } },
          select: { id: true, productId: true, batchId: true, product: { select: { unit: true } } },
        });
        if (!inventory) throw new Error("Inventory item could not be found after the order deduction.");
        await recordInventoryMovement(tx, {
          farmId: currentFarmId(),
          inventoryItemId: inventory.id,
          productId: inventory.productId,
          batchId: line.batchId || inventory.batchId,
          date: created.date,
          movementType: "SALE",
          quantity: Number(line.quantity),
          unit: inventory.product?.unit || "each",
          referenceType: "SALE",
          referenceId: created.id,
          notes: "Inventory deducted by AURA-confirmed WhatsApp order.",
        });
      }
      return created;
    });
    return NextResponse.json({ order: result, deduplicated: false, message: "Order confirmed and inventory deducted." }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm the order." }, { status: 409 });
  }
}
