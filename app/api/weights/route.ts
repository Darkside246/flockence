import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, FARM_ID } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { calculateLiveBirdsAtDate, isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

const WEIGHT_SCOPES = ["SAMPLE", "INDIVIDUAL", "BATCH_AVERAGE"] as const;
const WEIGHT_TYPES = ["LIVE", "DRESSED"] as const;


export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.weightRecord.findMany({
    where: { batch: { farmId: FARM_ID } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { batch: true },
  }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;

  try {
    await ensureFarm();
    const input = await request.json();
    const batchId = typeof input.batchId === "string" ? input.batchId : "";
    const date = parseCalendarDate(input.date);
    const quantity = Number(input.quantity);
    const avgWeightKg = Number(input.avgWeightKg);
    const scope = typeof input.scope === "string" ? input.scope : "SAMPLE";
    const liveOrDressed = typeof input.liveOrDressed === "string" ? input.liveOrDressed : "LIVE";

    if (
      !batchId ||
      !date ||
      !isCalendarDateNotFuture(date) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      !Number.isFinite(avgWeightKg) ||
      avgWeightKg <= 0
    ) {
      return NextResponse.json(
        { error: "Batch, a current or historical date, a positive whole-bird quantity and a positive average weight are required." },
        { status: 400 },
      );
    }
    if (!(WEIGHT_SCOPES as readonly string[]).includes(scope)) {
      return NextResponse.json({ error: "Select a supported weight scope." }, { status: 400 });
    }
    if (!(WEIGHT_TYPES as readonly string[]).includes(liveOrDressed)) {
      return NextResponse.json({ error: "Select either live or dressed weight." }, { status: 400 });
    }

    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId: FARM_ID },
      select: { id: true, startDate: true, initialChicks: true, productionType: true, species: true },
    });
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    const isLayerBatch = batch.productionType === "LAYER" || batch.species.toUpperCase() === "LAYER";
    if (isLayerBatch && liveOrDressed === "DRESSED") {
      return NextResponse.json({ error: "Layer flocks use live-weight records. Broiler dressed-weight records are not available for layer flocks." }, { status: 409 });
    }

    const batchStartDate = new Date(`${batch.startDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (date < batchStartDate) {
      return NextResponse.json({ error: "A weight record cannot be dated before the flock start date." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockFlockOperations(tx, [batch.id]);

      const [snapshot, deaths, dispatches] = await Promise.all([
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
          select: { sentQuantity: true, slaughtered: true, date: true, createdAt: true },
        }),
      ]);
      const liveBirdsOnDate = calculateLiveBirdsAtDate(
        batch.initialChicks,
        snapshot,
        [
          ...deaths.map((row) => ({ quantity: row.quantity, date: row.date, createdAt: row.createdAt })),
          ...dispatches.map((row) => ({ quantity: row.sentQuantity, date: row.date, createdAt: row.createdAt })),
        ],
        date,
      );
      const slaughteredBirdsOnDate = dispatches.reduce((sum, row) => sum + row.slaughtered, 0);
      if (liveOrDressed === "LIVE" && (liveBirdsOnDate == null || quantity > liveBirdsOnDate)) {
        throw new Error("Birds weighed cannot exceed the reconciled live bird count for that date.");
      }
      if (liveOrDressed === "DRESSED" && quantity > slaughteredBirdsOnDate) {
        throw new Error("Dressed birds weighed cannot exceed the birds recorded as slaughtered by that date.");
      }

      // A flock has one record for a given date, scope and weight type.
      // Re-entering the same measurement updates it instead of silently duplicating it.
      const existing = await tx.weightRecord.findFirst({
        where: { batchId: batch.id, date, scope, liveOrDressed },
        orderBy: { createdAt: "desc" },
      });
      const data = { quantity, avgWeightKg, scope, liveOrDressed };

      if (existing) {
        return {
          record: await tx.weightRecord.update({ where: { id: existing.id }, data }),
          updated: true,
        };
      }

      return {
        record: await tx.weightRecord.create({
          data: { batchId: batch.id, date, ...data },
        }),
        updated: false,
      };
    });

    return NextResponse.json(result.record, { status: result.updated ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record weight." },
      { status: 400 },
    );
  }
}
