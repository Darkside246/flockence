import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm, FARM_ID } from "@/lib/operations";
import { prisma } from "@/lib/prisma";
import { assertHarvestAllowed } from "@/lib/withdrawal";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { calculateLiveBirdsAtDate, isCalendarDateNotFuture, isWithinInitialFlockCount, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;

  try {
    await ensureFarm();
    const input = await request.json();
    const batchId = typeof input.batchId === "string" ? input.batchId : "";
    const date = parseCalendarDate(input.date);
    const sentQuantity = Number(input.sentQuantity);
    const slaughtered = input.slaughtered == null || input.slaughtered === ""
      ? sentQuantity
      : Number(input.slaughtered);
    const condemned = input.condemned == null || input.condemned === ""
      ? 0
      : Number(input.condemned);
    const slaughterCostMinor = Number(input.slaughterCostMinor ?? 0);

    if (
      !batchId ||
      !date ||
      !isCalendarDateNotFuture(date) ||
      !Number.isSafeInteger(sentQuantity) ||
      sentQuantity < 1 ||
      !Number.isSafeInteger(slaughtered) ||
      slaughtered < 0 ||
      !Number.isSafeInteger(condemned) ||
      condemned < 0
    ) {
      return NextResponse.json({
        error: "Batch, a current or historical date, and whole-bird counts are required. Birds sent must be positive.",
      }, { status: 400 });
    }
    if (slaughtered + condemned !== sentQuantity) {
      return NextResponse.json({
        error: "Every bird sent to the processor must be accounted for as slaughtered or condemned. The totals must equal birds sent.",
      }, { status: 400 });
    }
    if (!Number.isSafeInteger(slaughterCostMinor) || slaughterCostMinor < 0) {
      return NextResponse.json({ error: "Slaughter cost must be a non-negative amount in minor currency units." }, { status: 400 });
    }

    const liveWeightKg = input.liveWeightKg == null || input.liveWeightKg === "" ? null : Number(input.liveWeightKg);
    const dressedWeightKg = input.dressedWeightKg == null || input.dressedWeightKg === "" ? null : Number(input.dressedWeightKg);
    if (liveWeightKg !== null && (!Number.isFinite(liveWeightKg) || liveWeightKg <= 0)) {
      return NextResponse.json({ error: "Live weight must be a positive number of kilograms when supplied." }, { status: 400 });
    }
    if (dressedWeightKg !== null && (!Number.isFinite(dressedWeightKg) || dressedWeightKg <= 0)) {
      return NextResponse.json({ error: "Dressed weight must be a positive number of kilograms when supplied." }, { status: 400 });
    }
    if (liveWeightKg !== null && dressedWeightKg !== null && dressedWeightKg > liveWeightKg) {
      return NextResponse.json({ error: "Dressed weight cannot exceed live weight." }, { status: 400 });
    }

    const chillingCompletedAt = input.chillingCompletedAt
      ? new Date(input.chillingCompletedAt)
      : null;
    if (chillingCompletedAt && Number.isNaN(chillingCompletedAt.getTime())) {
      return NextResponse.json({ error: "Chilling completion time is invalid." }, { status: 400 });
    }

    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId: FARM_ID },
      select: {
        id: true,
        name: true,
        species: true,
        productionType: true,
        startDate: true,
        initialChicks: true,
      },
    });
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    if (batch.productionType === "LAYER" || batch.species.toUpperCase() === "LAYER") {
      return NextResponse.json({
        error: "Layer flocks do not use the broiler slaughter workflow. Record egg production or a separately authorized end-of-lay event.",
      }, { status: 409 });
    }

    const batchStartDate = new Date(`${batch.startDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (date < batchStartDate) {
      return NextResponse.json({ error: "Slaughter cannot be recorded before the flock start date." }, { status: 400 });
    }

    const harvestDayEnd = new Date(date);
    harvestDayEnd.setUTCDate(harvestDayEnd.getUTCDate() + 1);

    try {
      await assertHarvestAllowed(batch.id, date);
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Harvest blocked by withdrawal.",
      }, { status: 409 });
    }

    const event = await prisma.$transaction(async (tx) => {
      await lockFlockOperations(tx, [batch.id]);

      const currentBatch = await tx.batch.findFirst({
        where: { id: batch.id, farmId: FARM_ID },
        select: { id: true, initialChicks: true },
      });
      if (!currentBatch) throw new Error("Batch not found.");

      const withdrawalBlockers = await tx.treatment.findMany({
        where: {
          farmId: FARM_ID,
          batchId: batch.id,
          startedAt: { lt: harvestDayEnd },
          OR: [
            { status: "ACTIVE", withdrawalClearsAt: null },
            { withdrawalClearsAt: { gt: date } },
          ],
        },
        select: { productName: true, withdrawalClearsAt: true },
      });
      if (withdrawalBlockers.length > 0) {
        throw new Error("HARVEST_BLOCKED_WITHDRAWAL: " + withdrawalBlockers.map((row) => row.productName).join(", "));
      }

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
      if (availableOnFarm == null || sentQuantity > availableOnFarm) {
        throw new Error("Birds sent on this date cannot exceed the reconciled birds on the farm.");
      }

      if (!isWithinInitialFlockCount(
        currentBatch.initialChicks,
        allMortality._sum.quantity ?? 0,
        allSlaughter._sum.sentQuantity ?? 0,
        0,
        sentQuantity,
      )) {
        throw new Error("Birds sent plus recorded deaths cannot exceed the flock's remaining bird count.");
      }

      const created = await tx.slaughterEvent.create({
        data: {
          batchId: batch.id,
          date,
          sentQuantity,
          slaughtered,
          condemned,
          slaughterCostMinor,
          liveWeightKg,
          dressedWeightKg,
          chillingCompletedAt,
          notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null,
        },
      });

      const [totalMortality, totalSlaughter] = await Promise.all([
        tx.mortalityEvent.aggregate({
          where: { batchId: batch.id },
          _sum: { quantity: true },
        }),
        tx.slaughterEvent.aggregate({
          where: { batchId: batch.id },
          _sum: { sentQuantity: true },
        }),
      ]);

      const liveCount = Math.max(0, availableOnFarm - sentQuantity);
      await tx.birdCount.create({
        data: {
          batchId: batch.id,
          date,
          liveCount,
          note: "Calculated after slaughter and condemnation entry",
        },
      });

      const totalAccounted = (totalMortality._sum.quantity ?? 0) + (totalSlaughter._sum.sentQuantity ?? 0);
      const fullyProcessed = totalAccounted >= currentBatch.initialChicks;
      const latestSlaughter = fullyProcessed
        ? await tx.slaughterEvent.findFirst({
            where: { batchId: batch.id },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            select: { date: true },
          })
        : null;
      await tx.batch.update({
        where: { id: batch.id },
        data: {
          actualSlaughter: fullyProcessed ? latestSlaughter?.date ?? date : null,
          status: fullyProcessed ? "SLAUGHTERED" : "ACTIVE",
        },
      });

      return created;
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record slaughter.";
    return NextResponse.json(
      { error: message.replace("HARVEST_BLOCKED_WITHDRAWAL: ", "") },
      { status: message.includes("HARVEST_BLOCKED_WITHDRAWAL") ? 409 : 400 },
    );
  }
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.slaughterEvent.findMany({
    where: { batch: { farmId: FARM_ID } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { batch: true },
  }));
}
