import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response; await ensureFarm(); return NextResponse.json(await prisma.productionPlan.findMany({ where: { farmId: currentFarmId() }, orderBy: { startDate: "asc" } })); }

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm(); const input = await request.json();
    if (!input.name || !Number.isInteger(input.batchSize) || input.batchSize < 1) return NextResponse.json({ error: "Plan name and positive batch size are required." }, { status: 400 });
    const plan = await prisma.productionPlan.create({ data: { farmId: currentFarmId(), name: input.name, batchSize: input.batchSize, staggerWeeks: Math.max(1, input.staggerWeeks ?? 3), targetSlaughterWeeks: Math.max(1, input.targetSlaughterWeeks ?? 6), expectedMortalityPercent: Math.max(0, input.expectedMortalityPercent ?? 10), startDate: new Date(input.startDate || new Date()) } });
    return NextResponse.json(plan, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create plan." }, { status: 400 }); }
}
