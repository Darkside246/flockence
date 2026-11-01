import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import {
  assessStorageTemperature,
  calendarDateInTimeZone,
  isCalendarDateNotFuture,
  parseCalendarDate,
  parseDateTimeInTimeZone,
} from "@/lib/poultry-metrics.mjs";

function parseReadingDate(value: unknown): Date | null {
  if (value == null || value === "") return new Date();
  if (typeof value !== "string") return null;

  // Date-only input is stored at UTC midnight to preserve its calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseCalendarDate(value);
  }

  // datetime-local input is a wall time in Barbados, independent of the
  // browser or server timezone. Other timestamps must include a timezone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    return parseDateTimeInTimeZone(value);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();

  const { searchParams } = new URL(request.url);
  const storageLocationId = searchParams.get("storageLocationId");
  const requestedLimit = Number(searchParams.get("limit") ?? 50);
  const take = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 200)
    : 50;
  const rows = await prisma.storageTemperatureLog.findMany({
    where: { farmId: FARM_ID, ...(storageLocationId ? { storageLocationId } : {}) },
    include: { storageLocation: true },
    orderBy: { date: "desc" },
    take,
  });

  return NextResponse.json(rows.map((row) => ({
    ...row,
    temperatureAssessment: assessStorageTemperature(
      Number(row.temperatureC),
      row.storageLocation.temperatureMinC,
      row.storageLocation.temperatureMaxC,
    ),
  })));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;

  try {
    await ensureFarm();
    const input = await request.json();
    const storageLocationId = typeof input.storageLocationId === "string" ? input.storageLocationId.trim() : "";
    const rawTemperature = input.temperatureC;
    const temperatureC = rawTemperature == null || rawTemperature === "" ? NaN : Number(rawTemperature);

    if (!storageLocationId || !Number.isFinite(temperatureC) || temperatureC < -100 || temperatureC > 100) {
      return NextResponse.json({
        error: "Choose a storage location and enter a valid temperature between -100°C and 100°C.",
      }, { status: 400 });
    }

    const date = parseReadingDate(input.date);
    if (!date || !Number.isFinite(date.getTime())) {
      return NextResponse.json({ error: "Enter a valid storage reading date." }, { status: 400 });
    }
    const dateOnlyInput = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date);
    const readingCalendarDate = dateOnlyInput ? String(input.date) : calendarDateInTimeZone(date);
    if (
      !readingCalendarDate ||
      !isCalendarDateNotFuture(readingCalendarDate) ||
      (!dateOnlyInput && date.getTime() > Date.now())
    ) {
      return NextResponse.json({ error: "Storage readings cannot be dated in the future on the farm calendar." }, { status: 400 });
    }

    if (input.notes != null && typeof input.notes !== "string") {
      return NextResponse.json({ error: "Temperature notes must be text." }, { status: 400 });
    }
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) || null : null;
    const measuredBy = typeof input.measuredBy === "string" ? input.measuredBy.trim().slice(0, 120) || null : null;

    const location = await prisma.storageLocation.findFirst({
      where: { id: storageLocationId, farmId: FARM_ID, active: true },
    });
    if (!location) return NextResponse.json({ error: "Storage location not found." }, { status: 404 });

    const temperatureAssessment = assessStorageTemperature(
      temperatureC,
      location.temperatureMinC,
      location.temperatureMaxC,
    );
    const row = await prisma.storageTemperatureLog.create({
      data: {
        farmId: FARM_ID,
        storageLocationId,
        date,
        temperatureC,
        measuredBy,
        notes,
      },
      include: { storageLocation: true },
    });

    return NextResponse.json({ ...row, temperatureAssessment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not record storage temperature.",
    }, { status: 400 });
  }
}
