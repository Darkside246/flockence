import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { authorizeAuraIntegration, signAuraQuote } from "@/lib/aura-integration";

const fulfillmentMethods = new Set(["PICKUP", "DELIVERY"]);
export async function POST(request: Request) {
  if (!authorizeAuraIntegration(request)) return NextResponse.json({ error: "INVALID_INTEGRATION_TOKEN" }, { status: 401 });
  try {
    await ensureFarm();
    const input = await request.json();
    const fulfillmentMethod = String(input.fulfillmentMethod || "PICKUP").toUpperCase();
    const items = Array.isArray(input.items) ? input.items : [];
    if (!fulfillmentMethods.has(fulfillmentMethod) || !items.length || items.length > 20) return NextResponse.json({ error: "fulfillmentMethod and at least one order item are required." }, { status: 400 });
    if (fulfillmentMethod === "DELIVERY" && !String(input.deliveryAddress || "").trim()) return NextResponse.json({ error: "A confirmed delivery address is required for delivery orders." }, { status: 400 });

    const lines: any[] = [];
    for (const raw of items) {
      const productId = String(raw?.productId || "").trim(), quantity = Number(raw?.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: "Every item needs a productId and a positive quantity." }, { status: 400 });
      const inventory = await prisma.inventoryItem.findFirst({
        where: { productId, product: { farmId: currentFarmId() }, status: "AVAILABLE", quantity: { gte: quantity } },
        include: { product: true, batch: true },
        orderBy: { createdAt: "asc" },
      });
      if (!inventory) {
        const available = await prisma.inventoryItem.aggregate({ where: { productId, product: { farmId: currentFarmId() }, status: "AVAILABLE" }, _sum: { quantity: true } });
        return NextResponse.json({ error: "INSUFFICIENT_STOCK", productId, availableQuantity: Number(available._sum.quantity ?? 0) }, { status: 409 });
      }
      const unitPriceMinor = inventory.sellingPriceMinor ?? inventory.product.defaultPriceMinor;
      if (unitPriceMinor == null) return NextResponse.json({ error: "PRICE_NOT_CONFIGURED", productId, productName: inventory.product.name }, { status: 409 });
      lines.push({ productId, productName: inventory.product.name, inventoryItemId: inventory.id, batchId: inventory.batchId, quantity, unit: inventory.product.unit, unitPriceMinor, totalMinor: Math.round(quantity * unitPriceMinor) });
    }
    const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
    const expiresAt = Date.now() + 10 * 60_000;
    const quoteToken = signAuraQuote({ v: 1, farmId: currentFarmId(), expiresAt, fulfillmentMethod, lines, totalMinor });
    return NextResponse.json({ quoteToken, expiresAt: new Date(expiresAt).toISOString(), currency: "BBD", fulfillmentMethod, lines: lines.map(({ inventoryItemId: _i, batchId: _b, ...line }) => line), totalMinor });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not quote the order." }, { status: 400 });
  }
}
