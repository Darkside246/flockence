import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { assessStorageCapacity, assessStorageTemperature } from "@/lib/poultry-metrics.mjs";

type LocationWrite = {
  name: string;
  type: string;
  capacityKg: number | null;
  temperatureTargetC: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  notes: string | null;
};

function optionalBound(value: unknown): { valid: boolean; value: number | null } {
  if (value == null || value === "") return { valid: true, value: null };
  const number = Number(value);
  return {
    valid: Number.isFinite(number) && number >= -100 && number <= 100,
    value: Number.isFinite(number) ? number : null,
  };
}

function parseLocationWrite(input: unknown): { valid: true; value: LocationWrite } | { valid: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Storage location details are required." };
  }

  const data = input as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim().slice(0, 120) : "";
  const type = String(data.type || "COLD").trim().toUpperCase();
  if (!name) return { valid: false, error: "Storage location name is required." };

  const capacity = data.capacityKg == null || data.capacityKg === "" ? null : Number(data.capacityKg);
  if (capacity != null && (!Number.isFinite(capacity) || capacity < 0 || capacity > 100000000)) {
    return { valid: false, error: "Storage capacity must be a valid non-negative kg amount." };
  }

  const target = optionalBound(data.temperatureTargetC);
  const minimum = optionalBound(data.temperatureMinC);
  const maximum = optionalBound(data.temperatureMaxC);
  if (!target.valid || !minimum.valid || !maximum.valid) {
    return { valid: false, error: "Target and limit temperatures must be valid values between -100°C and 100°C." };
  }
  if (minimum.value != null && maximum.value != null && minimum.value > maximum.value) {
    return { valid: false, error: "Minimum temperature cannot be higher than maximum temperature." };
  }
  if (
    target.value != null &&
    ((minimum.value != null && target.value < minimum.value) ||
      (maximum.value != null && target.value > maximum.value))
  ) {
    return { valid: false, error: "Target temperature must fall within the configured minimum and maximum." };
  }

  return {
    valid: true,
    value: {
      name,
      type,
      capacityKg: capacity,
      temperatureTargetC: target.value,
      temperatureMinC: minimum.value,
      temperatureMaxC: maximum.value,
      notes: typeof data.notes === "string" ? data.notes.trim().slice(0, 1000) || null : null,
    },
  };
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();

  const [locations, inventory] = await Promise.all([
    prisma.storageLocation.findMany({
      where: { farmId: FARM_ID },
      include: { temperatureLogs: { orderBy: { date: "desc" }, take: 1 } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.inventoryItem.findMany({
      where: {
        storageLocationId: { not: null },
        product: { farmId: FARM_ID },
        status: { in: ["AVAILABLE", "RESERVED"] },
      },
      select: { storageLocationId: true, weightKg: true, quantity: true, product: { select: { unit: true } } },
    }),
  ]);

  const currentKg = new Map<string, number>();
  const unweighedItemCount = new Map<string, number>();
  const stockItemCount = new Map<string, number>();
  for (const item of inventory) {
    if (!item.storageLocationId) continue;
    stockItemCount.set(item.storageLocationId, (stockItemCount.get(item.storageLocationId) ?? 0) + 1);

    const unit = String(item.product?.unit ?? "").trim().toLowerCase();
    const quantityIsKg = ["kg", "kgs", "kilogram", "kilograms"].includes(unit);
    const explicitKg = item.weightKg == null ? null : Number(item.weightKg);
    const rawKg = explicitKg == null || (explicitKg === 0 && quantityIsKg)
      ? (quantityIsKg ? item.quantity : null)
      : explicitKg;
    if (rawKg == null) {
      unweighedItemCount.set(item.storageLocationId, (unweighedItemCount.get(item.storageLocationId) ?? 0) + 1);
      continue;
    }

    const kg = Number(rawKg);
    if (!Number.isFinite(kg) || kg < 0) {
      unweighedItemCount.set(item.storageLocationId, (unweighedItemCount.get(item.storageLocationId) ?? 0) + 1);
      continue;
    }
    currentKg.set(item.storageLocationId, (currentKg.get(item.storageLocationId) ?? 0) + kg);
  }

  return NextResponse.json(locations.map((location) => {
    const recordedKg = Number((currentKg.get(location.id) ?? 0).toFixed(3));
    const capacityKg = location.capacityKg == null ? null : Number(location.capacityKg);
    const missingWeightCount = unweighedItemCount.get(location.id) ?? 0;
    const capacityAssessment = assessStorageCapacity(recordedKg, capacityKg, missingWeightCount);

    return {
      ...location,
      currentKg: recordedKg,
      unweighedItemCount: missingWeightCount,
      stockItemCount: stockItemCount.get(location.id) ?? 0,
      capacityUsePercent: capacityAssessment.utilizationPercent,
      capacityExceeded: capacityAssessment.exceedsCapacity,
      capacityAssessment,
      temperatureLogs: location.temperatureLogs.map((log) => ({
        ...log,
        assessment: assessStorageTemperature(
          Number(log.temperatureC),
          location.temperatureMinC,
          location.temperatureMaxC,
        ),
      })),
    };
  }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;

  try {
    await ensureFarm();
    const parsed = parseLocationWrite(await request.json());
    if (!parsed.valid) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const row = await prisma.storageLocation.create({
      data: { farmId: FARM_ID, ...parsed.value },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not create storage location.",
    }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;

  try {
    await ensureFarm();
    const input = await request.json();
    const inputRecord = input != null && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : null;
    const id = typeof inputRecord?.id === "string" ? inputRecord.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Storage location ID is required." }, { status: 400 });

    const parsed = parseLocationWrite(input);
    if (!parsed.valid) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const result = await prisma.storageLocation.updateMany({
      where: { id, farmId: FARM_ID },
      data: parsed.value,
    });
    if (result.count === 0) return NextResponse.json({ error: "Storage location not found." }, { status: 404 });

    const row = await prisma.storageLocation.findFirst({ where: { id, farmId: FARM_ID } });
    return row
      ? NextResponse.json(row)
      : NextResponse.json({ error: "Storage location not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not update storage location.",
    }, { status: 400 });
  }
}
