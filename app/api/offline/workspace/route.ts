import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request);
  if (access.response) return access.response;
  const [farm, flocks] = await Promise.all([
    prisma.farm.findUniqueOrThrow({ where: { id: access.user.farmId }, select: { name: true } }),
    prisma.batch.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({
    scope: { farmId: access.user.farmId, userId: access.user.id },
    farm: farm.name,
    today: calendarDateInTimeZone(new Date()),
    flocks,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
