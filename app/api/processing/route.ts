import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { recordInventoryMovement } from "@/lib/inventory-ledger";
import { assertHarvestAllowed } from "@/lib/withdrawal";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { calendarDateInTimeZone, isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

const allowedCategories = new Set(["CARCASS","GIBLET","FEET","PART","BYPRODUCT","WASTE"]);

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  const rows = await prisma.processingOutput.findMany({
    where: { batch: { farmId: currentFarmId() }, ...(batchId ? { batchId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { batch: true, slaughterEvent: true, inventoryItem: { include: { product: true } } }
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.batchId || !input.slaughterEventId || !Array.isArray(input.outputs) || input.outputs.length === 0) {
      return NextResponse.json({ error: "Batch, a recorded slaughter event and at least one processing output are required." }, { status: 400 });
    }
    const batch = await prisma.batch.findFirst({ where: { id: input.batchId, farmId: currentFarmId() } });
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    if (batch.productionType === "LAYER" || batch.species.toUpperCase() === "LAYER") {
      return NextResponse.json({ error: "Egg production is managed through egg collection and grading, not the broiler processing pack." }, { status: 409 });
    }
    const slaughterEvent = await prisma.slaughterEvent.findFirst({
      where: { id: String(input.slaughterEventId), batchId: batch.id },
    });
    if (!slaughterEvent) return NextResponse.json({ error: "The selected slaughter event was not found for this flock." }, { status: 404 });
    if (slaughterEvent.slaughtered < 1) {
      return NextResponse.json({ error: "The selected slaughter event has no slaughtered birds available for processing." }, { status: 409 });
    }

    const processingDate = slaughterEvent.date;
    if (!processingDate || !isCalendarDateNotFuture(processingDate)) {
      return NextResponse.json({ error: "Processing must use a valid current or historical slaughter date." }, { status: 400 });
    }
    const processingDayEnd = new Date(processingDate);
    processingDayEnd.setUTCDate(processingDayEnd.getUTCDate() + 1);
    try {
      await assertHarvestAllowed(batch.id, processingDate);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Processing blocked by withdrawal." }, { status: 409 });
    }

    const outputs = input.outputs.map((x: any) => ({
      productName: String(x.productName || "").trim(),
      category: String(x.category || "PART").toUpperCase(),
      quantity: Number(x.quantity),
      unit: String(x.unit || "each").trim(),
      weightKg: x.weightKg == null || x.weightKg === "" ? null : Number(x.weightKg),
      unitPriceMinor: x.unitPriceMinor == null || x.unitPriceMinor === "" ? null : Number(x.unitPriceMinor),
      costBasisMinor: x.costBasisMinor == null || x.costBasisMinor === "" ? 0 : Number(x.costBasisMinor),
      notes: x.notes ? String(x.notes) : null,
      storageLocationId: x.storageLocationId ? String(x.storageLocationId) : null,
      lotCode: x.lotCode ? String(x.lotCode) : null,
      packedAt: x.packedAt ? new Date(x.packedAt) : null,
      packedAtDay: x.packedAt ? parseCalendarDate(String(x.packedAt).slice(0, 10)) : null,
      useByDate: x.useByDate ? new Date(x.useByDate) : null,
      useByDay: x.useByDate ? parseCalendarDate(String(x.useByDate).slice(0, 10)) : null,
      storageState: x.storageState ? String(x.storageState).toUpperCase() : null,
    }));
    const requestedNames = outputs.map((row: { productName: string }) => row.productName.toLocaleLowerCase());
    if (new Set(requestedNames).size !== requestedNames.length) {
      return NextResponse.json({ error: "Each product can appear only once in a processing submission. Combine its quantity into one line." }, { status: 400 });
    }

    const locationIds = Array.from(new Set(outputs.map((x: { storageLocationId: string | null }) => x.storageLocationId).filter(Boolean)));
    if (locationIds.length) {
      const locations = await prisma.storageLocation.findMany({ where: { farmId: currentFarmId(), id: { in: locationIds as string[] }, active: true }, select: { id: true } });
      if (locations.length !== locationIds.length) return NextResponse.json({ error: "One or more storage locations are invalid." }, { status: 400 });
    }

    for (const x of outputs) {
      if (!x.productName || !allowedCategories.has(x.category) || !Number.isFinite(x.quantity) || x.quantity <= 0) {
        return NextResponse.json({ error: "Each output needs a name, valid category and positive quantity." }, { status: 400 });
      }
      if (x.weightKg !== null && (!Number.isFinite(x.weightKg) || x.weightKg < 0)) return NextResponse.json({ error: "Output weight must be zero or greater." }, { status: 400 });
      if (x.unitPriceMinor !== null && (!Number.isSafeInteger(x.unitPriceMinor) || x.unitPriceMinor < 0)) return NextResponse.json({ error: "Output price is invalid." }, { status: 400 });
      if (!Number.isSafeInteger(x.costBasisMinor) || x.costBasisMinor < 0) return NextResponse.json({ error: "Output cost basis is invalid." }, { status: 400 });
      if (x.packedAt !== null && (
        Number.isNaN(x.packedAt.getTime()) ||
        !x.packedAtDay ||
        !isCalendarDateNotFuture(x.packedAtDay) ||
        x.packedAtDay < processingDate
      )) {
        return NextResponse.json({ error: "Packed-at must be a valid current or historical date on or after the selected slaughter date." }, { status: 400 });
      }
      if (x.useByDate !== null && (
        Number.isNaN(x.useByDate.getTime()) ||
        !x.useByDay ||
        x.useByDay < (x.packedAtDay ?? processingDate)
      )) {
        return NextResponse.json({ error: "Use-by / review date must be valid and on or after the packed or slaughter date." }, { status: 400 });
      }
    }

    const created = await prisma.$transaction(async tx => {
      await lockFlockOperations(tx, [batch.id]);

      const existingOutputs = await tx.processingOutput.findMany({
        where: { batchId: batch.id, slaughterEventId: slaughterEvent.id },
        select: { productName: true },
      });
      const existingNames = new Set(existingOutputs.map((row: { productName: string }) => row.productName.trim().toLocaleLowerCase()));
      const duplicateNames = outputs
        .filter((row: { productName: string }) => existingNames.has(row.productName.toLocaleLowerCase()))
        .map((row: { productName: string }) => row.productName);
      if (duplicateNames.length > 0) {
        throw new Error("PROCESSING_ALREADY_RECORDED: These product lines already exist for this slaughter dispatch: " + [...new Set(duplicateNames)].join(", ") + ". Submit only product lines that have not been recorded yet.");
      }

      const withdrawalBlockers = await tx.treatment.findMany({
        where: {
          farmId: currentFarmId(),
          batchId: batch.id,
          startedAt: { lt: processingDayEnd },
          OR: [
            { status: "ACTIVE", withdrawalClearsAt: null },
            { withdrawalClearsAt: { gt: processingDate } },
          ],
        },
        select: { productName: true, withdrawalClearsAt: true },
      });
      if (withdrawalBlockers.length > 0) {
        throw new Error("PROCESSING_BLOCKED_WITHDRAWAL: " + withdrawalBlockers.map((row) => row.productName).join(", "));
      }
      const rows = [];
      for (const x of outputs) {
        const product = x.category === "WASTE" ? null : await tx.product.upsert({
          where: { farmId_name: { farmId: currentFarmId(), name: x.productName } },
          update: x.unit ? { unit: x.unit } : {},
          create: { farmId: currentFarmId(), name: x.productName, unit: x.unit, defaultPriceMinor: x.unitPriceMinor }
        });
        const inventory = product ? await tx.inventoryItem.create({
          data: {
            productId: product.id,
            batchId: batch.id,
            quantity: x.quantity,
            weightKg: x.weightKg,
            costBasisMinor: x.costBasisMinor,
            sellingPriceMinor: x.unitPriceMinor,
            storageLocationId: x.storageLocationId,
            lotCode: x.lotCode || `${batch.name.replace(/[^A-Za-z0-9]+/g, "-")}-${calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0,10)}-${x.productName.replace(/[^A-Za-z0-9]+/g, "-")}`.slice(0,120),
            packedAt: x.packedAt,
            useByDate: x.useByDate,
            storageState: x.storageState || "CHILLED"
          }
        }) : null;
        const row = await tx.processingOutput.create({
          data: {
            batchId: batch.id,
            slaughterEventId: slaughterEvent?.id || null,
            productName: x.productName,
            category: x.category,
            quantity: x.quantity,
            unit: x.unit,
            weightKg: x.weightKg,
            unitPriceMinor: x.unitPriceMinor,
            costBasisMinor: x.costBasisMinor,
            notes: x.notes,
            storageLocationId: x.storageLocationId,
            lotCode: x.lotCode || `${batch.name.replace(/[^A-Za-z0-9]+/g, "-")}-${calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0,10)}-${x.productName.replace(/[^A-Za-z0-9]+/g, "-")}`.slice(0,120),
            packedAt: x.packedAt,
            useByDate: x.useByDate,
            storageState: x.storageState || null,
            status: x.category === "WASTE" ? "DISPOSED" : "AVAILABLE",
            inventoryItemId: inventory?.id || null
          },
          include: { inventoryItem: { include: { product: true } } }
        });
        if (inventory && product) await recordInventoryMovement(tx, {
          farmId: currentFarmId(),
          inventoryItemId: inventory.id,
          productId: product.id,
          batchId: batch.id,
          date: processingDate,
          movementType: "PRODUCTION",
          quantity: x.quantity,
          unit: x.unit,
          weightKg: x.weightKg,
          referenceType: "PROCESSING_OUTPUT",
          referenceId: row.id,
          toLocationId: x.storageLocationId,
          notes: x.notes,
        });
        rows.push(row);
      }
      return rows;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record processing outputs.";
    return NextResponse.json(
      { error: message.replace("PROCESSING_BLOCKED_WITHDRAWAL: ", "").replace("PROCESSING_ALREADY_RECORDED: ", "") },
      { status: message.includes("PROCESSING_BLOCKED_WITHDRAWAL") || message.includes("PROCESSING_ALREADY_RECORDED") ? 409 : 400 },
    );
  }
}
