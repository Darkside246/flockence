import { readAccountForm } from "@/lib/account-form-security";
import { offlineEventId } from "@/lib/offline-event";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
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
    const input = await readAccountForm(request);
    if (!input) return NextResponse.json({ error: "Invalid expense details." }, { status: 400 });
    if (input.offline !== undefined) {
      const id = offlineEventId(request, input.offline, session.user);
      if (!id) return NextResponse.json({ error: "Sign in as the original farm account to sync this expense." }, { status: 403 });
      const date = typeof input.date === "string" ? parseCalendarDate(input.date) : null;
      const category = typeof input.category === "string" ? input.category.trim() : "";
      const description = typeof input.description === "string" ? input.description.trim() : "";
      const amountMinor = input.amountMinor;
      const currency = typeof input.currency === "string" ? input.currency : "";
      if (!date || !isCalendarDateNotFuture(date) || !category || category.length > 80 || !description || description.length > 300
        || typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 2147483647
        || Object.keys(input).some(key => !["date", "category", "description", "amountMinor", "currency", "offline"].includes(key))) {
        return NextResponse.json({ error: "Enter a valid expense date, category, description and amount." }, { status: 400 });
      }
      const farmId = currentFarmId();
      const expense = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`;
        const existing = await tx.expense.findUnique({ where: { id, farmId } });
        if (existing) {
          if (existing.date.getTime() !== date.getTime() || existing.category !== category
            || existing.description !== description || existing.amountMinor !== amountMinor) return null;
          return existing;
        }
        const farm = await tx.farm.findUniqueOrThrow({ where: { id: farmId }, select: { currency: true } });
        if (currency !== farm.currency) return null;
        return tx.expense.create({ data: { id, farmId, date, category, description, amountMinor, allocationMethod: "FARM_WIDE" } });
      });
      if (!expense) return NextResponse.json({ error: "The expense details or farm currency changed. Review the draft online." }, { status: 409 });
      return NextResponse.json(expense, { status: 201 });
    }
    if (!input.date || !input.category || !input.description || input.amountMinor == null) return NextResponse.json({ error: "Date, category, description and amount are required." }, { status: 400 });
    if (input.supplierId && !(await prisma.supplier.findFirst({ where: { id: String(input.supplierId), farmId: currentFarmId() }, select: { id: true } }))) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    const row = await prisma.expense.create({ data: { farmId: currentFarmId(), batchId: (input.batchId as string) || null, supplierId: (input.supplierId as string) || null, date: new Date(input.date as string), category: input.category as string, description: input.description as string, amountMinor: input.amountMinor as number, economicCost: input.economicCost !== false, allocationMethod: (input.allocationMethod as "FARM_WIDE") || "FARM_WIDE", recordStatus: "ACTUAL" } });
    return NextResponse.json(row, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid expense" }, { status: 400 }); }
}
