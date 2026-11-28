import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { convertFeed } from "@/lib/feed-entry";
import { feedCostPerKg, feedLabel } from "@/lib/feed-catalogue";
import { kgToBags } from "@/lib/farm-engine.mjs";
import { penRecordDenied } from "@/lib/pen-access";

/**
 * Feed used, recorded on its own in a few seconds: flock, amount and how it was counted (bags, kg, g, lb or the farm's
 * own scoop or pan). Stored as kilograms with the original entry kept. The daily flock check records feed too; both are
 * feed put out and both count once each.
 */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batchId = new URL(request.url).searchParams.get("batchId");
  const rows = await prisma.feedUsage.findMany({ where: { batch: { farmId: currentFarmId() }, ...(batchId ? { batchId } : {}) }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 60, include: { batch: { select: { name: true } } } });
  return NextResponse.json(rows.map(r => ({ ...r, quantityKg: Number(r.quantityKg), enteredQuantity: r.enteredQuantity == null ? null : Number(r.enteredQuantity) })));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const input = await request.json().catch(() => ({}));
  const farmId = currentFarmId();
  const batchId = String(input.batchId || "");
  const penDenied = await penRecordDenied(session.user, { batchId });
  if (penDenied) return penDenied;
  const date = parseCalendarDate(String(input.date || ""));
  if (!batchId || !date || !isCalendarDateNotFuture(date)) return NextResponse.json({ error: "Choose the flock and a date that is today or earlier." }, { status: 400 });
  const id = typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId) ? "use:" + input.submissionId : undefined;
  try {
    const result = await prisma.$transaction(async tx => {
      const batch = await tx.batch.findFirst({ where: { id: batchId, farmId }, select: { id: true, name: true, startDate: true } });
      if (!batch) return { status: 404, error: "Flock not found." };
      if (id) { const again = await tx.feedUsage.findUnique({ where: { id } }); if (again) return { status: 200, row: again, repeated: true }; }
      if (date < new Date(batch.startDate.toISOString().slice(0, 10) + "T00:00:00Z")) return { status: 400, error: "Feed cannot be recorded before the flock was placed." };
      const product = input.feedProductId ? await tx.feedProduct.findFirst({ where: { id: String(input.feedProductId), farmId } }) : null;
      if (input.feedProductId && !product) return { status: 404, error: "That feed is not in the catalogue." };
      const conv = await convertFeed(tx, farmId, { amount: input.amount, unit: input.unit, feedProductId: product?.id, measureId: input.measureId ? String(input.measureId) : null });
      if (!conv.ok) return { status: 400, error: conv.error };
      if (conv.kg <= 0) return { status: 400, error: "Enter how much feed was used." };
      const cost = await feedCostPerKg(tx, farmId, product?.id, date);
      const row = await tx.feedUsage.create({ data: {
        ...(id ? { id } : {}), batchId, date, quantityKg: conv.kg, costMinor: cost ? Math.round(conv.kg * cost.perKgMinor) : 0,
        feedType: product ? feedLabel(product) : cost?.feedType ?? "Feed", feedProductId: product?.id ?? cost?.feedProductId ?? null,
        enteredQuantity: conv.enteredQuantity, enteredUnit: conv.enteredUnit, penId: typeof input.penId === "string" && input.penId ? input.penId.slice(0, 64) : null,
        note: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 300) : null,
      } });
      return { status: 201, row, basis: conv.basis, bags: kgToBags(conv.kg, conv.bagKg), costKnown: Boolean(cost) };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    const { row, ...rest } = result;
    return NextResponse.json({ ...row, quantityKg: Number(row!.quantityKg), ...rest }, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save." }, { status: 400 });
  }
}

/** Remove a feed entry made by mistake (owner or manager). Entries made by the daily flock check are changed there. */
export async function DELETE(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const id = new URL(request.url).searchParams.get("id");
  const row = id ? await prisma.feedUsage.findFirst({ where: { id, batch: { farmId: currentFarmId() } } }) : null;
  if (!row) return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  if (row.id.startsWith("daily:")) return NextResponse.json({ error: "This came from a daily flock check. Change it on that check instead." }, { status: 409 });
  await prisma.feedUsage.delete({ where: { id: row.id } });
  return NextResponse.json({ deleted: true });
}
