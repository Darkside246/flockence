import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response; await ensureFarm(); return NextResponse.json(await prisma.expense.findMany({ where: { farmId: currentFarmId() }, orderBy: { date: "desc" }, take: 100 })); }

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.date || !input.category || !input.description || input.amountMinor == null) return NextResponse.json({ error: "Date, category, description and amount are required." }, { status: 400 });
    const row = await prisma.expense.create({ data: { farmId: currentFarmId(), batchId: input.batchId || null, date: new Date(input.date), category: input.category, description: input.description, amountMinor: input.amountMinor, economicCost: input.economicCost !== false, allocationMethod: input.allocationMethod || "FARM_WIDE", recordStatus: "ACTUAL" } });
    return NextResponse.json(row, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid expense" }, { status: 400 }); }
}
