import { offlineEventId } from "@/lib/offline-event";
import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { closeIfEmpty, liveBirdsOn, loadFlockLedger } from "@/lib/flock-ledger";

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
    const syncId = input.offline === undefined ? undefined : offlineEventId(request, input.offline, session.user);
    if (syncId === null) return NextResponse.json({ error: "Sign in as the original farm account to sync this entry." }, { status: 403 });
    if (syncId && Object.keys(input).some(key => !["batchId", "date", "feedKg", "offline"].includes(key))) {
      return NextResponse.json({ error: "Offline feed entries accept only the flock, date and feed amount." }, { status: 400 });
    }
    const batchId = String(input.batchId || "");
    // Owner, 2026-11-02: deaths are easy to record, live birds are hard to count. The live count is optional: left
    // blank, it is worked out from the starting birds, recorded deaths and birds sent to slaughter; a number typed in
    // is a head count and becomes the new starting point.
    const counted = input.liveCount !== "" && input.liveCount != null;
    const countedLive = counted ? Number(input.liveCount) : null;
    // Deaths are counted first, then the live count follows from them. Deaths typed here are saved as a mortality record
    // for the same day, in the same step as the check, so the two can never disagree.
    const diedText = input.diedCount === "" || input.diedCount == null ? "" : String(input.diedCount);
    const diedCount = diedText === "" ? 0 : Number(diedText);
    if (!Number.isSafeInteger(diedCount) || diedCount < 0) {
      return NextResponse.json({ error: "Birds that died must be a whole number of 0 or more." }, { status: 400 });
    }
    const culledText = input.culledCount === "" || input.culledCount == null ? "" : String(input.culledCount);
    const culledCount = culledText === "" ? 0 : Number(culledText);
    if (!Number.isSafeInteger(culledCount) || culledCount < 0) {
      return NextResponse.json({ error: "Birds culled must be a whole number of 0 or more." }, { status: 400 });
    }
    const diedReason = typeof input.diedReason === "string" && input.diedReason.trim() ? input.diedReason.trim().slice(0, 120) : null;
    const submissionId = typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId) ? input.submissionId : null;
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
    if (syncId && (feedKg == null || feedKg > 999999999 || Number(feedKg.toFixed(3)) !== feedKg)) {
      return NextResponse.json({ error: "Enter feed in kilograms with three decimal places or fewer." }, { status: 400 });
    }
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
      if (syncId) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${syncId}, 0))::text`;
      await lockFlockOperations(tx, [batchId]);
      if (syncId) {
        const receipt = await tx.dailyFlockCheck.findUnique({ where: { id: syncId } });
        if (receipt) {
          if (receipt.batchId !== batchId || receipt.date.getTime() !== date.getTime() || feedKg == null || !receipt.feedKg?.equals(feedKg)) {
            throw new Error("OFFLINE_FEED_CONFLICT: This feed entry already synced with different details.");
          }
          return receipt;
        }
        if (await tx.dailyFlockCheck.findUnique({ where: { batchId_date: { batchId, date } } })
          || await tx.feedUsage.findFirst({ where: { batchId, date }, select: { id: true } })) {
          throw new Error("OFFLINE_FEED_CONFLICT: This flock already has a daily check or feed record for that date. Review the records online.");
        }
      }

      // 1. Losses first: found dead, then culled (removed on purpose). Each is its own record so they are never mixed.
      // A repeat of the same submission (a retry after a dropped connection) is recognised and not counted twice.
      const losses: Array<[kind: "DIED" | "CULLED", count: number, prefix: string, reason: string | null]> = [["DIED", diedCount, "daily-died:", diedReason], ["CULLED", culledCount, "daily-culled:", null]];
      for (const [kind, count, prefix, reason] of losses) {
        if (count <= 0) continue;
        const lossId = submissionId ? prefix + submissionId : undefined;
        if (lossId && await tx.mortalityEvent.findUnique({ where: { id: lossId } })) continue;
        const available = await liveBirdsOn(tx, batchId, date);
        if (count > available) throw new Error(`${count} birds recorded as ${kind === "DIED" ? "dead" : "culled"}, but only ${available} were on the farm on that date.`);
        await tx.mortalityEvent.create({ data: { ...(lossId ? { id: lossId } : {}), batchId, date, quantity: count, kind, reason, notes: "Counted at the daily flock check." } });
        await tx.birdCount.create({ data: { batchId, date, liveCount: available - count, note: "Calculated after mortality entry" } });
      }
      if (diedCount > 0 || culledCount > 0) {
        const after = await loadFlockLedger(tx, batchId);
        if (!after?.balance.ok) throw new Error(after?.balance.error ?? "These losses do not fit the flock's later records.");
        await closeIfEmpty(tx, batchId);
      }

      // 2. Then the live count, which now already has those deaths taken off.
      const maximumOnFarmCount = await liveBirdsOn(tx, batchId, date);
      if (countedLive != null && countedLive > maximumOnFarmCount) {
        throw new Error(`You counted ${countedLive}, but the records only account for ${maximumOnFarmCount} birds on that date. If birds were added, record them under Change bird numbers first.`);
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
          ...(syncId ? { id: syncId } : {}), farmId: currentFarmId(), batchId, date, liveCount, feedKg, waterLiters, avgWeightKg,
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

      const now = await loadFlockLedger(tx, batchId);
      return { ...check, liveBirdsNow: now?.balance.live ?? null, lossesRecorded: diedCount + culledCount };
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save daily flock check.";
    const conflict = message.startsWith("OFFLINE_FEED_CONFLICT:");
    return NextResponse.json({ error: message.replace(/^OFFLINE_FEED_CONFLICT: /, "") }, { status: conflict ? 409 : 400 });
  }
}
