import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm, FARM_ID } from "@/lib/operations";
import { authorizeAuraIntegration } from "@/lib/aura-integration";

export async function GET(request: Request) {
  if (!authorizeAuraIntegration(request)) return NextResponse.json({ error: "INVALID_INTEGRATION_TOKEN" }, { status: 401 });
  await ensureFarm();
  const rows = await prisma.inventoryItem.findMany({
    where: { product: { farmId: FARM_ID }, status: "AVAILABLE" },
    include: { product: true, batch: true },
    orderBy: [{ createdAt: "asc" }],
  });
  const products = new Map<string, { productId: string; name: string; unit: string; availableQuantity: number; priceMinor: number | null }>();
  for (const row of rows) {
    const quantity = Number(row.quantity);
    if (!(quantity > 0)) continue;
    const priceMinor = row.sellingPriceMinor ?? row.product.defaultPriceMinor ?? null;
    const existing = products.get(row.productId);
    if (existing) {
      existing.availableQuantity += quantity;
      if (existing.priceMinor === null && priceMinor !== null) existing.priceMinor = priceMinor;
    } else {
      products.set(row.productId, { productId: row.productId, name: row.product.name, unit: row.product.unit, availableQuantity: quantity, priceMinor });
    }
  }
  const farm = await prisma.farm.findUnique({ where: { id: FARM_ID }, select: { id: true, name: true, currency: true } });
  return NextResponse.json({ farm: farm ?? { id: FARM_ID, name: "Farm", currency: "BBD" }, products: Array.from(products.values()) });
}
