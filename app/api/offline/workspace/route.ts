import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request);
  if (access.response) return access.response;
  const canRecordSales = access.user.role === "OWNER" || access.user.role === "MANAGER";
  const [farm, flocks, saleLots] = await Promise.all([
    prisma.farm.findUniqueOrThrow({ where: { id: access.user.farmId }, select: { name: true, currency: true } }),
    prisma.batch.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, productionType: true, species: true }, orderBy: { name: "asc" } }),
    canRecordSales ? prisma.inventoryItem.findMany({
      where: { product: { farmId: access.user.farmId }, batchId: { not: null }, status: "AVAILABLE", quantity: { gt: 0 } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100,
      select: { id: true, batchId: true, lotCode: true, quantity: true, sellingPriceMinor: true, product: { select: { name: true, unit: true } } },
    }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    scope: { farmId: access.user.farmId, userId: access.user.id },
    farm: farm.name,
    currency: farm.currency,
    canRecordSales,
    saleLots,
    canRecordTreatments: access.user.role === "OWNER" || access.user.role === "MANAGER",
    canRecordExpenses: access.user.role === "OWNER" || access.user.role === "MANAGER",
    today: calendarDateInTimeZone(new Date()),
    flocks: flocks.map(({ id, name, productionType, species }) => ({ id, name, layer: productionType === "LAYER" || species.toUpperCase() === "LAYER" })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
