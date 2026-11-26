import { offlineEventId as scopedOfflineEventId } from "@/lib/offline-event";
import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { calculateLiveBirdsAtDate, isCalendarDateNotFuture, isWithinInitialFlockCount, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

class MortalityConflict extends Error {}

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
    let offlineEventId: string | undefined;
    if (input.offline !== undefined) {
      isOffline = true;
      offlineEventId = scopedOfflineEventId(request, input.offline, session.user) ?? undefined;
      if (!offlineEventId) return NextResponse.json({ error: "Sign in as the original farm account to sync this entry." }, { status: 403 });
      if ((reason?.length ?? 0) > 120 || (notes?.length ?? 0) > 1000) {
        return NextResponse.json({ error: "The offline reason or note is too long." }, { status: 400 });
      }
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
            || recorded.reason !== reason || recorded.notes !== notes) throw new MortalityConflict("This offline entry was already synced with different details.");
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

      const totalDeathsAfter = (allMortality._sum.quantity ?? 0) + quantity;
      const totalSentToProcessor = allSlaughter._sum.sentQuantity ?? 0;

      const created = await tx.mortalityEvent.create({
        data: {
          batchId: batch.id,
          date,
          quantity,
          ...(offlineEventId ? { id: offlineEventId } : {}),
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

      if (totalDeathsAfter + totalSentToProcessor >= currentBatch.initialChicks) {
        await tx.batch.update({
          where: { id: batch.id },
          data: { status: "CLOSED", actualSlaughter: null },
        });
      }

      return created;
    });

    return NextResponse.json(event, { status: 201 });
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
