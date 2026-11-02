import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { calculateLiveBirdsAtDate, isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

function validNumber(value: unknown, min = 0) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : null;
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  const rows = await prisma.dailyFlockCheck.findMany({
    where: { farmId: currentFarmId(), ...(batchId ? { batchId } : {}) },
    include: { batch: true },
    orderBy: { date: "desc" },
    take: 100,
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const batchId = String(input.batchId || "");
    // Owner, 2026-11-02: deaths are easy to record, live birds are hard to count. The live count is optional: left
    // blank, it is worked out from the starting birds, recorded deaths and birds sent to slaughter; a number typed in
    // is a head count and becomes the new starting point.
    const counted = input.liveCount !== "" && input.liveCount != null;
    const countedLive = counted ? Number(input.liveCount) : null;
    const dateText = String(input.date || "");
    if (!batchId || !dateText || (counted && (!Number.isSafeInteger(countedLive) || countedLive! < 0))) {
      return NextResponse.json({ error: "Batch and date are required, and a counted live bird number must be a whole number of 0 or more." }, { status: 400 });
    }

    const batch = await prisma.batch.findFirst({ where: { id: batchId, farmId: currentFarmId() }, select: { id: true, startDate: true, initialChicks: true } });
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

    const date = parseCalendarDate(dateText);
    if (!date || !isCalendarDateNotFuture(date)) {
      return NextResponse.json({ error: "Enter a valid current or historical calendar date for the flock check." }, { status: 400 });
    }
    if (countedLive != null && countedLive > batch.initialChicks) {
      return NextResponse.json({ error: "Live bird count cannot exceed the flock's initial bird count." }, { status: 400 });
    }
    const batchStartDate = new Date(`${batch.startDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (date < batchStartDate) {
      return NextResponse.json({ error: "A flock check cannot be dated before the flock start date." }, { status: 400 });
    }

    const feedKg = validNumber(input.feedKg);
    const waterLiters = validNumber(input.waterLiters);
    const avgWeightKg = validNumber(input.avgWeightKg, 0.001);
    const weightSampleQuantity = input.weightSampleQuantity === "" || input.weightSampleQuantity == null ? null : Number(input.weightSampleQuantity);
    const temperatureC = validNumber(input.temperatureC, -100);
    const humidityPercent = validNumber(input.humidityPercent);
    const ammoniaPpm = validNumber(input.ammoniaPpm);
    const invalidOptionalNumber = (value: unknown, min = 0) =>
      value !== "" && value != null && validNumber(value, min) === null;
    if (invalidOptionalNumber(input.feedKg)
      || invalidOptionalNumber(input.waterLiters)
      || invalidOptionalNumber(input.avgWeightKg, 0.001)
      || invalidOptionalNumber(input.temperatureC, -100)
      || invalidOptionalNumber(input.humidityPercent)
      || invalidOptionalNumber(input.ammoniaPpm)) {
      return NextResponse.json({ error: "Feed, water, weight, temperature, humidity and ammonia values must be valid numbers within their permitted ranges." }, { status: 400 });
    }
    if (weightSampleQuantity != null && (!Number.isSafeInteger(weightSampleQuantity) || weightSampleQuantity < 1)) {
      return NextResponse.json({ error: "Weight sample quantity must be a positive whole number." }, { status: 400 });
    }
    if (avgWeightKg != null && weightSampleQuantity == null) {
      return NextResponse.json({ error: "Weight sample quantity is required when average weight is recorded." }, { status: 400 });
    }
    if (avgWeightKg != null && weightSampleQuantity != null && countedLive != null && weightSampleQuantity > countedLive) {
      return NextResponse.json({ error: "Weight sample quantity cannot exceed the live bird count recorded for that day." }, { status: 400 });
    }
    if (humidityPercent != null && humidityPercent > 100) return NextResponse.json({ error: "Humidity cannot exceed 100%." }, { status: 400 });

    const latestBatchFeedPurchase = await prisma.feedPurchase.findFirst({
      where: { farmId: currentFarmId(), batchId, date: { lte: date } },
      orderBy: { date: "desc" },
    });
    const latestFeedPurchase = latestBatchFeedPurchase || await prisma.feedPurchase.findFirst({
      where: { farmId: currentFarmId(), batchId: null, date: { lte: date } },
      orderBy: { date: "desc" },
    });
    const row = await prisma.$transaction(async tx => {
      await lockFlockOperations(tx, [batchId]);

      const [latestSnapshot, deathsToDate, dispatchesToDate] = await Promise.all([
        tx.birdCount.findFirst({
          where: { batchId, date: { lte: date } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        }),
        tx.mortalityEvent.findMany({
          where: { batchId, date: { lte: date } },
          select: { quantity: true, date: true, createdAt: true },
        }),
        tx.slaughterEvent.findMany({
          where: { batchId, date: { lte: date } },
          select: { sentQuantity: true, date: true, createdAt: true },
        }),
      ]);
      const maximumOnFarmCount = calculateLiveBirdsAtDate(
        batch.initialChicks,
        latestSnapshot,
        [
          ...deathsToDate.map(event => ({
            quantity: event.quantity, date: event.date, createdAt: event.createdAt,
          })),
          ...dispatchesToDate.map(event => ({
            quantity: event.sentQuantity, date: event.date, createdAt: event.createdAt,
          })),
        ],
        date,
      );
      if (maximumOnFarmCount == null) throw new Error("The live bird count for that date could not be worked out from the flock's records.");
      if (countedLive != null && countedLive > maximumOnFarmCount) {
        throw new Error("Observed live bird count cannot exceed the reconciled on-farm count for that date.");
      }
      const liveCount = countedLive ?? maximumOnFarmCount;
      if (avgWeightKg != null && weightSampleQuantity != null && weightSampleQuantity > liveCount) {
        throw new Error("Weight sample quantity cannot exceed the live bird count for that day.");
      }

      const weightRecord = avgWeightKg != null
        ? await tx.weightRecord.findFirst({
            where: { batchId, date, scope: "SAMPLE", liveOrDressed: "LIVE" },
            orderBy: { createdAt: "desc" },
          })
        : null;

      const check = await tx.dailyFlockCheck.upsert({
        where: { batchId_date: { batchId, date } },
        create: {
          farmId: currentFarmId(), batchId, date, liveCount, feedKg, waterLiters, avgWeightKg,
          weightSampleQuantity, temperatureC, humidityPercent, ammoniaPpm,
          litterCondition: input.litterCondition ? String(input.litterCondition) : null,
          pantingObserved: Boolean(input.pantingObserved),
          wingSpreadingObserved: Boolean(input.wingSpreadingObserved),
          notes: input.notes ? String(input.notes) : null,
        },
        update: {
          liveCount, feedKg, waterLiters, avgWeightKg, weightSampleQuantity,
          temperatureC, humidityPercent, ammoniaPpm,
          litterCondition: input.litterCondition ? String(input.litterCondition) : null,
          pantingObserved: Boolean(input.pantingObserved),
          wingSpreadingObserved: Boolean(input.wingSpreadingObserved),
          notes: input.notes ? String(input.notes) : null,
        },
      });

      // A head count becomes a new dated snapshot (ordered after earlier flock events); a worked-out count is not
      // stored as one, so it can never hide a death recorded later for the same day.
      if (countedLive != null) {
        await tx.birdCount.create({
          data: { batchId, date, liveCount: countedLive, note: "Head count from daily flock check." },
        });
      }

      if (avgWeightKg != null) {
        if (weightRecord) {
          await tx.weightRecord.update({ where: { id: weightRecord.id }, data: { quantity: weightSampleQuantity ?? 1, avgWeightKg, scope: "SAMPLE", liveOrDressed: "LIVE" } });
        } else {
          await tx.weightRecord.create({ data: { batchId, date, quantity: weightSampleQuantity ?? 1, avgWeightKg, scope: "SAMPLE", liveOrDressed: "LIVE" } });
        }
      }

      if (feedKg != null && latestFeedPurchase && Number(latestFeedPurchase.bagSizeKg) > 0) {
        const costPerKg = latestFeedPurchase.unitCostMinor / Number(latestFeedPurchase.bagSizeKg);
        const costMinor = Math.max(0, Math.round(feedKg * costPerKg));
        const existingFeed = await tx.feedUsage.findFirst({ where: { batchId, date, feedType: latestFeedPurchase.feedType } });
        if (existingFeed) {
          await tx.feedUsage.update({ where: { id: existingFeed.id }, data: { quantityKg: feedKg, costMinor, note: "Updated from daily flock check." } });
        } else {
          await tx.feedUsage.create({ data: { batchId, date, feedType: latestFeedPurchase.feedType, quantityKg: feedKg, costMinor, note: "Created from daily flock check." } });
        }
      }

      if (temperatureC != null || humidityPercent != null || ammoniaPpm != null || input.litterCondition || input.pantingObserved || input.wingSpreadingObserved) {
        const symptom = (input.pantingObserved || input.wingSpreadingObserved) ? "Heat / welfare signs observed" : "Daily environment check";
        const existingObservation = await tx.healthObservation.findFirst({ where: { batchId, observedAt: date, symptom } });
        const observationData = {
          farmId: currentFarmId(), batchId, observedAt: date, symptom, category: "ENVIRONMENT",
          affectedCount: liveCount, severity: (input.pantingObserved || input.wingSpreadingObserved) ? "HIGH" : "LOW" as any,
          notes: input.notes ? String(input.notes) : null,
          temperatureC, humidityPercent,
        };
        if (existingObservation) await tx.healthObservation.update({ where: { id: existingObservation.id }, data: observationData });
        else await tx.healthObservation.create({ data: observationData });
      }

      return check;
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save daily flock check." }, { status: 400 });
  }
}
