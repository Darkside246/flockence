import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { normalizeOptionalBoolean, validateProcessorTripCounts } from "@/lib/poultry-metrics.mjs";

const types = new Set([
  "CHICK_DELIVERY",
  "LIVE_BIRD_TO_PROCESSOR",
  "LIVE_BIRD_MARKET",
  "PROCESSED_MEAT",
  "EGG_DELIVERY",
  "OTHER",
]);

function optionalWholeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  const requestedLimit = Number(searchParams.get("limit") ?? 30);
  const take = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 30;

  return NextResponse.json(await prisma.transportEvent.findMany({
    where: { farmId: FARM_ID, ...(batchId ? { batchId } : {}) },
    orderBy: { departureAt: "desc" },
    take,
    include: { batch: true, slaughterEvent: true },
  }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;

  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.type || !types.has(input.type) || typeof input.departureAt !== "string" || !input.departureAt.trim()) {
      return NextResponse.json({ error: "Transport type and departure time are required." }, { status: 400 });
    }
    if (input.arrivalAt != null && input.arrivalAt !== "" && typeof input.arrivalAt !== "string") {
      return NextResponse.json({ error: "Arrival time must be a valid date and time." }, { status: 400 });
    }

    const departure = new Date(input.departureAt);
    const arrival = input.arrivalAt ? new Date(input.arrivalAt) : null;
    if (Number.isNaN(departure.getTime()) || (arrival && Number.isNaN(arrival.getTime()))) {
      return NextResponse.json({ error: "Enter valid departure and arrival dates." }, { status: 400 });
    }
    if (arrival && arrival < departure) {
      return NextResponse.json({ error: "Arrival cannot be earlier than departure." }, { status: 400 });
    }

    const batch = input.batchId
      ? await prisma.batch.findFirst({ where: { id: input.batchId, farmId: FARM_ID } })
      : null;
    if (input.batchId && !batch) {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    if (input.slaughterEventId && !batch) {
      return NextResponse.json({ error: "Select the flock before linking a slaughter dispatch." }, { status: 400 });
    }
    if (input.slaughterEventId && input.type !== "LIVE_BIRD_TO_PROCESSOR") {
      return NextResponse.json({ error: "A slaughter dispatch can only be linked to live-bird-to-processor transport." }, { status: 400 });
    }

    const slaughterEvent = input.slaughterEventId
      ? await prisma.slaughterEvent.findFirst({
          where: {
            id: String(input.slaughterEventId),
            ...(batch ? { batchId: batch.id } : {}),
            batch: { farmId: FARM_ID },
          },
        })
      : null;
    if (input.slaughterEventId && !slaughterEvent) {
      return NextResponse.json({ error: "The selected slaughter event was not found for this farm and batch." }, { status: 404 });
    }

    const birdsLoaded = optionalWholeNumber(input.birdsLoaded);
    const birdsArrived = optionalWholeNumber(input.birdsArrived);
    const birdsDeadOnArrival = optionalWholeNumber(input.birdsDeadOnArrival ?? 0);
    if (
      (input.birdsLoaded != null && birdsLoaded == null) ||
      (input.birdsArrived != null && birdsArrived == null) ||
      birdsDeadOnArrival == null
    ) {
      return NextResponse.json({ error: "Loaded, arrived and dead-on-arrival bird counts must be whole non-negative numbers." }, { status: 400 });
    }
    if (birdsLoaded === null && (birdsArrived !== null || birdsDeadOnArrival > 0)) {
      return NextResponse.json({ error: "Enter birds loaded before recording bird arrivals or dead-on-arrival counts." }, { status: 400 });
    }
    if (
      birdsLoaded !== null &&
      (birdsDeadOnArrival > birdsLoaded ||
        (birdsArrived !== null && birdsArrived + birdsDeadOnArrival > birdsLoaded))
    ) {
      return NextResponse.json({ error: "Birds arriving alive plus dead on arrival cannot exceed birds loaded." }, { status: 400 });
    }

    if (input.type === "LIVE_BIRD_TO_PROCESSOR") {
      if (!batch || !slaughterEvent) {
        return NextResponse.json({
          error: "A live-bird-to-processor trip must be linked to its flock and slaughter dispatch.",
        }, { status: 400 });
      }
      if (arrival == null || birdsLoaded == null || birdsArrived == null) {
        return NextResponse.json({
          error: "A processor delivery needs arrival time, birds loaded and birds arriving alive.",
        }, { status: 400 });
      }
      const reconciliation = validateProcessorTripCounts({
        birdsLoaded,
        birdsArrived,
        birdsDeadOnArrival,
        sentQuantity: slaughterEvent.sentQuantity,
        slaughtered: slaughterEvent.slaughtered,
        condemned: slaughterEvent.condemned,
      });
      if (!reconciliation.valid) {
        return NextResponse.json(
          { error: reconciliation.message },
          { status: reconciliation.conflict ? 409 : 400 },
        );
      }
      const departureDay = String(input.departureAt).slice(0, 10);
      const slaughterDay = slaughterEvent.date.toISOString().slice(0, 10);
      if (departureDay !== slaughterDay) {
        return NextResponse.json({
          error: "The processor transport date must match the linked slaughter dispatch date.",
        }, { status: 409 });
      }
    }

    const crateCount = optionalWholeNumber(input.crateCount);
    if (input.crateCount != null && crateCount == null) {
      return NextResponse.json({ error: "Crate count must be a whole non-negative number." }, { status: 400 });
    }

    const numericFields = [
      ["distanceKm", input.distanceKm],
      ["ambientTempC", input.ambientTempC],
      ["feedWithdrawalHours", input.feedWithdrawalHours],
    ] as const;
    for (const [name, value] of numericFields) {
      if (value != null && value !== "" && !Number.isFinite(Number(value))) {
        return NextResponse.json({ error: `${name} must be a valid number.` }, { status: 400 });
      }
    }
    if (input.distanceKm != null && input.distanceKm !== "" && Number(input.distanceKm) < 0) {
      return NextResponse.json({ error: "Distance cannot be negative." }, { status: 400 });
    }
    if (input.feedWithdrawalHours != null && input.feedWithdrawalHours !== "" && Number(input.feedWithdrawalHours) < 0) {
      return NextResponse.json({ error: "Feed withdrawal hours cannot be negative." }, { status: 400 });
    }

    let journeyMinutes: number | null = null;
    if (arrival) {
      journeyMinutes = Math.round((arrival.getTime() - departure.getTime()) / 60000);
    } else if (input.journeyMinutes != null && input.journeyMinutes !== "") {
      const suppliedJourneyMinutes = Number(input.journeyMinutes);
      if (!Number.isSafeInteger(suppliedJourneyMinutes) || suppliedJourneyMinutes < 0) {
        return NextResponse.json({ error: "Journey duration must be a whole non-negative number of minutes." }, { status: 400 });
      }
      journeyMinutes = suppliedJourneyMinutes;
    }

    const waterAvailable = normalizeOptionalBoolean(input.waterAvailable);
    const welfareCheckCompleted = normalizeOptionalBoolean(input.welfareCheckCompleted);
    const sanitationCompleted = normalizeOptionalBoolean(input.sanitationCompleted);
    if (!waterAvailable.valid || !welfareCheckCompleted.valid || !sanitationCompleted.valid) {
      return NextResponse.json({ error: "Water availability, welfare check and sanitation values must be true or false." }, { status: 400 });
    }

    const createData = {
      farmId: FARM_ID,
      batchId: batch?.id || null,
      slaughterEventId: slaughterEvent?.id || null,
      type: input.type,
      departureAt: departure,
      arrivalAt: arrival,
      origin: input.origin || null,
      destination: input.destination || null,
      carrier: input.carrier || null,
      vehicle: input.vehicle || null,
      driverName: input.driverName || null,
      crateCount,
      birdsLoaded,
      birdsArrived,
      birdsDeadOnArrival,
      distanceKm: input.distanceKm == null || input.distanceKm === "" ? null : Number(input.distanceKm),
      journeyMinutes,
      ambientTempC: input.ambientTempC == null || input.ambientTempC === "" ? null : Number(input.ambientTempC),
      feedWithdrawalHours: input.feedWithdrawalHours == null || input.feedWithdrawalHours === "" ? null : Number(input.feedWithdrawalHours),
      waterAvailable: waterAvailable.value,
      welfareCheckCompleted: welfareCheckCompleted.value ?? false,
      sanitationCompleted: sanitationCompleted.value ?? false,
      notes: input.notes || null,
    };

    const row = await prisma.$transaction(async (tx) => {
      if (batch) {
        await lockFlockOperations(tx, [batch.id]);
      }

      if (input.type === "LIVE_BIRD_TO_PROCESSOR" && slaughterEvent) {
        const existingLinkedTrip = await tx.transportEvent.findFirst({
          where: {
            farmId: FARM_ID,
            slaughterEventId: slaughterEvent.id,
            type: "LIVE_BIRD_TO_PROCESSOR",
          },
          select: { id: true },
        });
        if (existingLinkedTrip) {
          throw new Error("PROCESSOR_TRIP_ALREADY_RECORDED: This slaughter dispatch already has a linked processor transport record.");
        }
      }

      return tx.transportEvent.create({ data: createData });
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record transport.";
    const conflict = message.includes("PROCESSOR_TRIP_ALREADY_RECORDED");
    return NextResponse.json({
      error: message.replace("PROCESSOR_TRIP_ALREADY_RECORDED: ", ""),
    }, { status: conflict ? 409 : 400 });
  }
}
