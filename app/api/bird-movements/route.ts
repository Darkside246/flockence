import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { liveBirdsOn, loadFlockLedger, rebuildBirdProjections } from "@/lib/flock-ledger";

/**
 * Birds joining a flock (ADDITION) or moving between houses inside it (TRANSFER). The flock keeps its identity and
 * history; an addition is not a new purchase of chicks for a new flock, and a transfer is neither a loss nor an addition.
 */
const text = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batchId = new URL(request.url).searchParams.get("batchId");
  const rows = await prisma.birdMovement.findMany({ where: { farmId: currentFarmId(), ...(batchId ? { batchId } : {}) }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send the movement." }, { status: 400 }); }
  const type = String(input.type || "");
  const batchId = String(input.batchId || "");
  const date = parseCalendarDate(String(input.date || ""));
  const quantity = Number(input.quantity);
  if (type !== "ADDITION" && type !== "TRANSFER") return NextResponse.json({ error: "Choose birds added or birds moved between houses." }, { status: 400 });
  if (!batchId || !date || !isCalendarDateNotFuture(date)) return NextResponse.json({ error: "Choose the flock and a date that is today or earlier." }, { status: 400 });
  if (!Number.isSafeInteger(quantity) || quantity < 1) return NextResponse.json({ error: "The number of birds must be a whole number of 1 or more." }, { status: 400 });
  const fromHouse = text(input.fromHouse), toHouse = text(input.toHouse);
  if (type === "TRANSFER" && (!fromHouse || !toHouse || fromHouse === toHouse)) return NextResponse.json({ error: "A move needs the house the birds left and a different house they went to." }, { status: 400 });
  const costMinor = input.costMinor == null || input.costMinor === "" ? null : Number(input.costMinor);
  if (costMinor !== null && (!Number.isSafeInteger(costMinor) || costMinor < 0)) return NextResponse.json({ error: "Cost must be zero or more." }, { status: 400 });
  const key = typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId) ? "move:" + input.submissionId : undefined;

  try {
    const result = await prisma.$transaction(async tx => {
      const batch = await tx.batch.findFirst({ where: { id: batchId, farmId: currentFarmId() }, select: { id: true, startDate: true, status: true } });
      if (!batch) return { status: 404 as const, error: "Flock not found." };
      if (date < new Date(batch.startDate.toISOString().slice(0, 10) + "T00:00:00.000Z")) return { status: 400 as const, error: "Birds cannot be added or moved before the flock was placed." };
      await lockFlockOperations(tx, [batchId]);
      if (key) {
        const again = await tx.birdMovement.findUnique({ where: { id: key } });
        if (again) return { status: 200 as const, movement: again, repeated: true, liveBirdsNow: (await loadFlockLedger(tx, batchId))?.balance.live ?? null };
      }
      if (type === "TRANSFER") {
        const live = await liveBirdsOn(tx, batchId, date);
        if (quantity > live) return { status: 409 as const, error: `Only ${live} birds were in this flock on that date.` };
      }
      const movement = await tx.birdMovement.create({ data: {
        ...(key ? { id: key } : {}), farmId: currentFarmId(), batchId, date, type, quantity, fromHouse, toHouse,
        source: type === "ADDITION" ? text(input.source) : null, costMinor: type === "ADDITION" ? costMinor : null,
        notes: text(input.notes, 400), createdByUserId: session.user!.id,
      } });
      const after = await loadFlockLedger(tx, batchId);
      if (!after?.balance.ok) throw new Error(after?.balance.error ?? "This does not fit the flock's records.");
      if (type === "ADDITION") {
        await rebuildBirdProjections(tx, batchId);
        if (batch.status === "CLOSED") await tx.batch.update({ where: { id: batchId }, data: { status: "ACTIVE" } });
      }
      return { status: 201 as const, movement, liveBirdsNow: after.balance.live, houses: after.balance.houses };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save." }, { status: 409 });
  }
}

/** Void a movement entered by mistake. It stays in the history, marked void, and stops counting. */
export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const id = new URL(request.url).searchParams.get("id");
  let input: { voidReason?: unknown };
  try { input = await request.json(); } catch { input = {}; }
  const why = text(input.voidReason, 300);
  if (!id || !why) return NextResponse.json({ error: "Choose the movement and say why it is being voided." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      const row = await tx.birdMovement.findFirst({ where: { id, farmId: currentFarmId() } });
      if (!row) return { status: 404 as const, error: "Movement not found." };
      if (row.voidedAt) return { status: 409 as const, error: "Already voided." };
      await lockFlockOperations(tx, [row.batchId]);
      await tx.birdMovement.update({ where: { id }, data: { voidedAt: new Date(), voidReason: why } });
      const after = await loadFlockLedger(tx, row.batchId);
      if (!after?.balance.ok) throw new Error("Removing these birds would leave later records with more birds lost than the flock had. Correct those first.");
      await rebuildBirdProjections(tx, row.batchId);
      await tx.auditLog.create({ data: { farmId: currentFarmId(), userId: session.user!.id, action: "VOID", entity: "BirdMovement", entityId: id, beforeJson: JSON.stringify(row), afterJson: JSON.stringify({ why, liveBirds: after.balance.live }) } });
      return { status: 200 as const, liveBirdsNow: after.balance.live };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not void." }, { status: 409 });
  }
}
