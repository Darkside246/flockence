import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request);
  if (access.response) return access.response;
  const [farm, flocks] = await Promise.all([
    prisma.farm.findUniqueOrThrow({ where: { id: access.user.farmId }, select: { name: true, currency: true } }),
    prisma.batch.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, productionType: true, species: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({
    scope: { farmId: access.user.farmId, userId: access.user.id },
    farm: farm.name,
    currency: farm.currency,
    canRecordTreatments: access.user.role === "OWNER" || access.user.role === "MANAGER",
    canRecordExpenses: access.user.role === "OWNER" || access.user.role === "MANAGER",
    today: calendarDateInTimeZone(new Date()),
    flocks: flocks.map(({ id, name, productionType, species }) => ({ id, name, layer: productionType === "LAYER" || species.toUpperCase() === "LAYER" })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
