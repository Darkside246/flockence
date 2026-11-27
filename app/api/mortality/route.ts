import { offlineEventId as scopedOfflineEventId } from "@/lib/offline-event";
import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { closeIfEmpty, loadFlockLedger, rebuildBirdProjections } from "@/lib/flock-ledger";
import { calculateLiveBirdsAtDate, isCalendarDateNotFuture, isWithinInitialFlockCount, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

class MortalityConflict extends Error {}

// A loss is a death, a cull (removed on purpose) or a bird that went missing. All three take birds off the flock.
const LOSS_KINDS = ["DIED", "CULLED", "MISSING"] as const;
// How the dead birds were disposed of (biosecurity record). Optional.
const DISPOSAL_METHODS = ["BURIED", "BURNED", "COMPOSTED", "RENDERED", "COLLECTED"] as const;

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const events = await prisma.mortalityEvent.findMany({
    where: { batch: { farmId: currentFarmId() } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { batch: true },
  });
  return NextResponse.json(events);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;

  let isOffline = false;
  try {
    await ensureFarm();
    const input = await request.json();
    const batchId = typeof input.batchId === "string" ? input.batchId : "";
    const date = parseCalendarDate(input.date);
    const quantity = Number(input.quantity);
    const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
    const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
    const kind = LOSS_KINDS.includes(String(input.kind) as never) ? String(input.kind) : "DIED";
    const disposal = DISPOSAL_METHODS.includes(String(input.disposal) as never) ? String(input.disposal) : null;
    let offlineEventId: string | undefined;
    if (input.offline !== undefined) {
      isOffline = true;
      offlineEventId = scopedOfflineEventId(request, input.offline, session.user) ?? undefined;
      if (!offlineEventId) return NextResponse.json({ error: "Sign in as the original farm account to sync this entry." }, { status: 403 });
      if ((reason?.length ?? 0) > 120 || (notes?.length ?? 0) > 1000) {
        return NextResponse.json({ error: "The offline reason or note is too long." }, { status: 400 });
      }
    }

    if (!offlineEventId && typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId)) {
      offlineEventId = "loss:" + input.submissionId;
    }

    if (!batchId || !date || !isCalendarDateNotFuture(date) || !Number.isSafeInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Batch, a current or historical date and a positive whole-bird quantity are required." },
        { status: 400 },
      );
    }

    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId: currentFarmId() },
      select: { id: true, startDate: true },
    });
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

    const batchStartDate = new Date(`${batch.startDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const event = await prisma.$transaction(async (tx) => {
      if (offlineEventId) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${offlineEventId}, 0))::text`;
        const recorded = await tx.mortalityEvent.findUnique({ where: { id: offlineEventId } });
        if (recorded) {
          if (recorded.batchId !== batchId || recorded.quantity !== quantity || recorded.date.getTime() !== date.getTime()
            || recorded.reason !== reason || recorded.notes !== notes || recorded.kind !== kind) throw new MortalityConflict("This offline entry was already synced with different details.");
          return recorded;
        }
      }
      if (date < batchStartDate) throw new MortalityConflict("Mortality cannot be recorded before the flock start date.");
      // All mortality writes for a flock serialize before checking its cumulative bird count.
      await lockFlockOperations(tx, [batch.id]);

      const currentBatch = await tx.batch.findFirst({
        where: { id: batch.id, farmId: currentFarmId() },
        select: { id: true, initialChicks: true },
      });
      if (!currentBatch) throw new Error("Batch not found.");

      const [allMortality, allSlaughter] = await Promise.all([
        tx.mortalityEvent.aggregate({
          where: { batchId: batch.id },
          _sum: { quantity: true },
        }),
        tx.slaughterEvent.aggregate({
          where: { batchId: batch.id },
          _sum: { sentQuantity: true },
        }),
      ]);
      const [latestSnapshot, deathsToDate, dispatchesToDate] = await Promise.all([
        tx.birdCount.findFirst({
          where: { batchId: batch.id, date: { lte: date } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        }),
        tx.mortalityEvent.findMany({
          where: { batchId: batch.id, date: { lte: date } },
          select: { quantity: true, date: true, createdAt: true },
        }),
        tx.slaughterEvent.findMany({
          where: { batchId: batch.id, date: { lte: date } },
          select: { sentQuantity: true, date: true, createdAt: true },
        }),
      ]);
      const availableOnFarm = calculateLiveBirdsAtDate(
        currentBatch.initialChicks,
        latestSnapshot,
        [
          ...deathsToDate.map(row => ({
            quantity: row.quantity, date: row.date, createdAt: row.createdAt,
          })),
          ...dispatchesToDate.map(row => ({
            quantity: row.sentQuantity, date: row.date, createdAt: row.createdAt,
          })),
        ],
        date,
      );
      if (availableOnFarm == null || quantity > availableOnFarm) {
        throw new MortalityConflict("Deaths recorded for this date cannot exceed the reconciled birds on the farm.");
      }

      if (!isWithinInitialFlockCount(
        currentBatch.initialChicks,
        allMortality._sum.quantity ?? 0,
        allSlaughter._sum.sentQuantity ?? 0,
        quantity,
        0,
      )) {
        throw new MortalityConflict("Deaths, slaughtered birds and condemned birds cannot exceed the flock's initial bird count.");
      }

      const created = await tx.mortalityEvent.create({
        data: {
          batchId: batch.id,
          date,
          quantity,
          ...(offlineEventId ? { id: offlineEventId } : {}),
          kind,
          disposal,
          reason,
          notes,
        },
      });

      // The new snapshot includes this event and all prior events effective on its date.
      const liveCount = Math.max(0, availableOnFarm - quantity);

      await tx.birdCount.create({
        data: {
          batchId: batch.id,
          date,
          liveCount,
          note: "Calculated after mortality entry",
        },
      });

      // Later records must still fit: a backdated loss can never leave a later day with fewer than zero birds.
      // The ledger also counts birds added or moved between flocks, which the totals above do not.
      const after = await loadFlockLedger(tx, batch.id);
      if (!after?.balance.ok) throw new MortalityConflict(after?.balance.error ?? "This loss does not fit the flock's later records.");
      await closeIfEmpty(tx, batch.id);

      return created;
    });

    const liveBirdsNow = await prisma.$transaction(async tx => (await loadFlockLedger(tx, batch.id))?.balance.live ?? null);
    return NextResponse.json({ ...event, liveBirdsNow }, { status: 201 });
  } catch (error) {
    if (isOffline) {
      if (error instanceof MortalityConflict) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ error: "Sync is temporarily unavailable. The device can retry safely." }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid mortality entry." },
      { status: 400 },
    );
  }
}

/**
 * Correct a loss that was entered wrongly (wrong number, or culled entered as died). The same record is changed, never a
 * second one added; the before and after go into the audit log, and the bird counts other pages read are rebuilt.
 */
export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const id = new URL(request.url).searchParams.get("id");
  let input: { quantity?: unknown; kind?: unknown; reason?: unknown; correctionReason?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send the correction." }, { status: 400 }); }
  if (!id) return NextResponse.json({ error: "Choose the record to correct." }, { status: 400 });
  const why = typeof input.correctionReason === "string" ? input.correctionReason.trim().slice(0, 300) : "";
  if (!why) return NextResponse.json({ error: "Say why it is being corrected, for the record." }, { status: 400 });
  const quantity = input.quantity == null || input.quantity === "" ? undefined : Number(input.quantity);
  if (quantity !== undefined && (!Number.isSafeInteger(quantity) || quantity < 1)) return NextResponse.json({ error: "The corrected number must be a whole number of 1 or more. To remove a loss entirely, ask the owner to delete the flock record." }, { status: 400 });
  const kind = input.kind === undefined ? undefined : String(input.kind);
  if (kind !== undefined && !LOSS_KINDS.includes(kind as never)) return NextResponse.json({ error: "Choose died, culled or missing." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.mortalityEvent.findFirst({ where: { id, batch: { farmId: currentFarmId() } } });
      if (!existing) return { status: 404 as const, error: "Record not found." };
      await lockFlockOperations(tx, [existing.batchId]);
      const before = await loadFlockLedger(tx, existing.batchId);
      const updated = await tx.mortalityEvent.update({
        where: { id },
        data: { ...(quantity !== undefined ? { quantity } : {}), ...(kind !== undefined ? { kind } : {}), ...(typeof input.reason === "string" ? { reason: input.reason.trim().slice(0, 120) || null } : {}), correctedAt: new Date() },
      });
      const after = await loadFlockLedger(tx, existing.batchId);
      if (!after?.balance.ok) throw new Error(after?.balance.error ?? "The correction does not fit the flock's other records.");
      await rebuildBirdProjections(tx, existing.batchId);
      await tx.auditLog.create({ data: {
        farmId: currentFarmId(), userId: session.user!.id, action: "CORRECT", entity: "MortalityEvent", entityId: id,
        beforeJson: JSON.stringify({ quantity: existing.quantity, kind: existing.kind, reason: existing.reason, liveBirds: before?.balance.live ?? null }),
        afterJson: JSON.stringify({ quantity: updated.quantity, kind: updated.kind, reason: updated.reason, liveBirds: after.balance.live, why }),
      } });
      return { status: 200 as const, liveBirdsBefore: before?.balance.live ?? null, liveBirdsNow: after.balance.live, flockStatus: after.batch.status };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ corrected: true, ...result, note: result.flockStatus !== "ACTIVE" && (result.liveBirdsNow ?? 0) > 0 ? "This flock is marked closed but now has birds. Reopen it from the flock page if they are still on the farm." : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not correct the record." }, { status: 409 });
  }
}
