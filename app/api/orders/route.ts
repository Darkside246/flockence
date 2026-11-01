import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";

const statuses = new Set(["NEW","CONFIRMED","PREPARING","READY","OUT_FOR_DELIVERY","COMPLETED","CANCELLED"]);

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const orders = await prisma.sale.findMany({
    where: { farmId: FARM_ID, orderStatus: { not: "COMPLETED" } },
    include: { items: true, customer: true },
    orderBy: { date: "desc" },
    take: 100,
  });
  return NextResponse.json(orders);
}

export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const id = String(input.id || "");
    const orderStatus = String(input.orderStatus || "").toUpperCase();
    if (!id || !statuses.has(orderStatus)) return NextResponse.json({ error: "Order id and a valid order status are required." }, { status: 400 });
    const order = await prisma.sale.updateMany({
      where: { id, farmId: FARM_ID },
      data: { orderStatus: orderStatus as any },
    });
    if (order.count !== 1) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    return NextResponse.json(await prisma.sale.findFirst({ where: { id, farmId: FARM_ID }, include: { items: true, customer: true } }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update order." }, { status: 400 });
  }
}
