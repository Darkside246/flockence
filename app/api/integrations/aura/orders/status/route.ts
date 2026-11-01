import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm, FARM_ID } from "@/lib/operations";
import { authorizeAuraIntegration } from "@/lib/aura-integration";

export async function GET(request: Request) {
  if (!authorizeAuraIntegration(request)) return NextResponse.json({ error: "INVALID_INTEGRATION_TOKEN" }, { status: 401 });
  await ensureFarm();
  const phone = String(new URL(request.url).searchParams.get("phone") || "").trim();
  if (!phone) return NextResponse.json({ error: "phone is required." }, { status: 400 });
  const sales = await prisma.sale.findMany({ where: { farmId: FARM_ID, customer: { phone }, source: "AURA_WHATSAPP" }, include: { items: true }, orderBy: { date: "desc" }, take: 10 });
  return NextResponse.json({ orders: sales.map((sale) => ({ orderId: sale.id, status: sale.orderStatus, totalMinor: sale.totalMinor, currency: "BBD", date: sale.date, fulfillmentMethod: sale.fulfillmentMethod, items: sale.items.map((item) => ({ description: item.description, quantity: Number(item.quantity) })) })) });
}
