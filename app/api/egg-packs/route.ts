import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { recordInventoryMovement } from "@/lib/inventory-ledger";
import { buildEggPackingPlan, isCalendarDateNotFuture, isCollectionDateWithinWithdrawal } from "@/lib/poultry-metrics.mjs";
import { lockFlockOperations } from "@/lib/poultry-lock";

const gradeLabels = {
  SMALL: "Small",
  MEDIUM: "Medium",
  LARGE: "Large",
  EXTRA_LARGE: "Extra Large",
  JUMBO: "Jumbo",
  UNGRADED: "Ungraded",
} as const;
type EggGrade = keyof typeof gradeLabels;
const grades = Object.keys(gradeLabels) as EggGrade[];

function parseDate(value: unknown) {
  const dateText = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const date = new Date(dateText + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText ? null : date;
}
function isLayer(batch: { productionType: string | null; species: string }) {
  return batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");
}
const qty = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId") || undefined;
  const grade = searchParams.get("grade")?.toUpperCase() as EggGrade | undefined;
  const whereGrade = grade && grades.includes(grade) ? grade : undefined;

  const [rawLots, packRuns] = await Promise.all([
    prisma.eggCollectionGrade.findMany({
      where: {
        ...(whereGrade ? { grade: whereGrade } : {}),
        eggCollection: { farmId: FARM_ID, batch: { farmId: FARM_ID }, ...(batchId ? { batchId } : {}) },
        inventoryItem: { is: { status: "AVAILABLE", quantity: { gt: 0 }, product: { farmId: FARM_ID } } },
      },
      include: {
        eggCollection: { include: { batch: true } },
        inventoryItem: { include: { product: true, batch: true } },
      },
      orderBy: [{ eggCollection: { date: "asc" } }, { eggCollection: { createdAt: "asc" } }],
      take: 1000,
    }),
    prisma.eggPackRun.findMany({
      where: { farmId: FARM_ID, ...(batchId ? { batchId } : {}) },
      include: {
        batch: true,
        outputInventoryItem: { include: { product: true, storageLocation: true } },
        inputs: { include: { inventoryItem: { include: { product: true, batch: true } } } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]);

  const lots = rawLots.filter((row) => row.inventoryItem).map((row) => ({
    id: row.inventoryItem!.id,
    lotCode: row.inventoryItem!.lotCode,
    product: row.inventoryItem!.product.name,
    grade: row.grade,
    batchId: row.eggCollection.batchId,
    batchName: row.eggCollection.batch.name,
    collectionDate: row.eggCollection.date,
    availableEggs: Number(row.inventoryItem!.quantity),
  }));
  const availableByGrade = Object.fromEntries(grades.map((gradeName) => [
    gradeName,
    lots.filter((lot) => lot.grade === gradeName).reduce((sum, lot) => sum + lot.availableEggs, 0),
  ]));

  return NextResponse.json({ lots, availableByGrade, packRuns });
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const grade = String(input.grade || "").toUpperCase() as EggGrade;
    const date = parseDate(input.date);
    const packSize = qty(input.packSize);
    const packCount = qty(input.packCount);
    const priceMinor = input.sellingPriceMinor == null || input.sellingPriceMinor === "" ? null : Number(input.sellingPriceMinor);
    const batchId = input.batchId ? String(input.batchId) : null;
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) : null;
    const useByDate = input.useByDate ? parseDate(input.useByDate) : null;
    const storageLocationId = input.storageLocationId ? String(input.storageLocationId) : null;

    if (!grades.includes(grade)) return NextResponse.json({ error: "Select a valid egg grade." }, { status: 400 });
    if (!date || !isCalendarDateNotFuture(date)) return NextResponse.json({ error: "Enter a valid current or historical packing date." }, { status: 400 });
    if (packSize == null || packSize < 1 || packSize > 60) return NextResponse.json({ error: "Pack size must be a whole number from 1 to 60 eggs." }, { status: 400 });
    if (packCount == null || packCount < 1 || packCount > 10000) return NextResponse.json({ error: "Pack count must be a whole number from 1 to 10,000." }, { status: 400 });
    if (priceMinor !== null && (!Number.isSafeInteger(priceMinor) || priceMinor < 0)) return NextResponse.json({ error: "Selling price must be a non-negative amount in minor currency units." }, { status: 400 });
    if (input.useByDate && !useByDate) return NextResponse.json({ error: "The best-before date is invalid." }, { status: 400 });
    if (useByDate && useByDate < date) return NextResponse.json({ error: "Best-before / review date cannot be before the packing date." }, { status: 400 });
    const totalEggs = packSize * packCount;
    if (!Number.isSafeInteger(totalEggs)) return NextResponse.json({ error: "The requested pack total is too large." }, { status: 400 });

    if (batchId) {
      const batch = await prisma.batch.findFirst({
        where: { id: batchId, farmId: FARM_ID },
        select: { id: true, productionType: true, species: true },
      });
      if (!batch || !isLayer(batch)) return NextResponse.json({ error: "Select a layer flock for this pack run." }, { status: 404 });
    }
    if (storageLocationId) {
      const location = await prisma.storageLocation.findFirst({ where: { id: storageLocationId, farmId: FARM_ID, active: true } });
      if (!location) return NextResponse.json({ error: "Storage location not found or inactive." }, { status: 404 });
    }

    const packCode = "EGG-PACK-" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const productName = `Egg Carton - ${packSize} - ${gradeLabels[grade]}`;
    const packedAt = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const rawLots = await tx.eggCollectionGrade.findMany({
        where: {
          grade,
          eggCollection: {
            farmId: FARM_ID,
            date: { lte: date },
            batch: { farmId: FARM_ID },
            ...(batchId ? { batchId } : {}),
          },
          inventoryItem: { is: { status: "AVAILABLE", quantity: { gt: 0 }, product: { farmId: FARM_ID } } },
        },
        include: { eggCollection: { include: { batch: true } }, inventoryItem: true },
        orderBy: [{ eggCollection: { date: "asc" } }, { eggCollection: { createdAt: "asc" } }],
      });

      const plan = buildEggPackingPlan(packSize, packCount, rawLots
        .filter((row) => row.inventoryItem)
        .map((row) => ({
          inventoryItemId: row.inventoryItem!.id,
          availableEggs: Number(row.inventoryItem!.quantity),
          collectionDate: row.eggCollection.date.toISOString() + "|" + row.eggCollection.createdAt.toISOString(),
        })));
      if (!plan.valid) {
        throw new Error(`PACKING_STOCK_SHORT: ${plan.errors.join(" ")}`);
      }
      const sourceById = new Map(rawLots.filter((row) => row.inventoryItem).map((row) => [row.inventoryItem!.id, row]));
      const sourceBatchIds = [...new Set(plan.allocations.map((allocation) => sourceById.get(allocation.inventoryItemId)?.eggCollection.batchId).filter((id): id is string => Boolean(id)))];
      await lockFlockOperations(tx, sourceBatchIds);
      const treatmentWindows = await tx.treatment.findMany({
        where: {
          farmId: FARM_ID,
          batchId: { in: sourceBatchIds },
          startedAt: { lt: packedAt },
          OR: [
            { withdrawalDays: { gt: 0 } },
            { status: "ACTIVE" },
          ],
        },
        select: { batchId: true, productName: true, startedAt: true, withdrawalClearsAt: true },
      });
      const affectedTreatmentNames = new Set<string>();
      for (const allocation of plan.allocations) {
        const source = sourceById.get(allocation.inventoryItemId);
        if (!source) throw new Error("PACKING_STOCK_CONFLICT: A selected source lot is no longer available.");
        for (const treatment of treatmentWindows) {
          if (
            treatment.batchId === source.eggCollection.batchId &&
            isCollectionDateWithinWithdrawal(
              treatment.startedAt,
              treatment.withdrawalClearsAt,
              source.eggCollection.date,
            )
          ) {
            affectedTreatmentNames.add(treatment.productName);
          }
        }
      }
      if (affectedTreatmentNames.size > 0) {
        throw new Error(`PACKING_WITHDRAWAL_BLOCKED: Selected egg lots were collected during a medication withdrawal period: ${[...affectedTreatmentNames].join(", ")}.`);
      }
      const outputBatchId = batchId || (sourceBatchIds.length === 1 ? sourceBatchIds[0] : null);
      const packRun = await tx.eggPackRun.create({
        data: {
          farmId: FARM_ID,
          batchId: outputBatchId,
          date,
          grade,
          packSize,
          packCount,
          totalEggs,
          packCode,
          packedAt,
          bestBeforeDate: useByDate,
          notes,
        },
      });

      for (const allocation of plan.allocations) {
        const source = sourceById.get(allocation.inventoryItemId);
        const inventory = source?.inventoryItem;
        if (!inventory) throw new Error("PACKING_STOCK_CONFLICT: A selected source lot is no longer available.");
        const taken = allocation.quantityEggs;
        const currentQuantity = Number(inventory.quantity);
        const update = await tx.inventoryItem.updateMany({
          where: { id: inventory.id, status: "AVAILABLE", quantity: { gte: taken } },
          data: {
            quantity: { decrement: taken },
            ...(currentQuantity - taken <= 0 ? { status: "PACKED" as const } : {}),
          },
        });
        if (update.count !== 1) throw new Error("PACKING_STOCK_CONFLICT: A source egg lot changed during this packing run.");

        await tx.eggPackInput.create({
          data: { packRunId: packRun.id, inventoryItemId: inventory.id, quantityEggs: taken },
        });
        await recordInventoryMovement(tx, {
          farmId: FARM_ID,
          inventoryItemId: inventory.id,
          productId: inventory.productId,
          batchId: inventory.batchId,
          date: packedAt,
          movementType: "PACKING",
          quantity: taken,
          unit: "egg",
          referenceType: "EGG_PACK",
          referenceId: packRun.id,
          notes: `Consumed into carton lot ${packCode}.`,
        });
      }

      const product = await tx.product.upsert({
        where: { farmId_name: { farmId: FARM_ID, name: productName } },
        update: priceMinor === null ? {} : { defaultPriceMinor: priceMinor },
        create: {
          farmId: FARM_ID,
          name: productName,
          unit: `carton of ${packSize}`,
          defaultPriceMinor: priceMinor,
        },
      });
      const output = await tx.inventoryItem.create({
        data: {
          productId: product.id,
          batchId: outputBatchId,
          quantity: packCount,
          costBasisMinor: 0,
          sellingPriceMinor: priceMinor ?? product.defaultPriceMinor,
          lotCode: packCode,
          packedAt,
          useByDate,
          storageLocationId,
          storageState: "PACKED",
        },
      });
      await tx.eggPackRun.update({
        where: { id: packRun.id },
        data: { outputInventoryItemId: output.id },
      });
      await recordInventoryMovement(tx, {
        farmId: FARM_ID,
        inventoryItemId: output.id,
        productId: product.id,
        batchId: outputBatchId,
        date: packedAt,
        movementType: "PRODUCTION",
        quantity: packCount,
        unit: `carton of ${packSize}`,
        referenceType: "EGG_PACK",
        referenceId: packRun.id,
        toLocationId: storageLocationId,
        notes: `Produced ${packCount} cartons of ${packSize} ${gradeLabels[grade]} eggs. Cost basis remains unallocated.`,
      });

      return tx.eggPackRun.findUniqueOrThrow({
        where: { id: packRun.id },
        include: {
          batch: true,
          outputInventoryItem: { include: { product: true, storageLocation: true } },
          inputs: { include: { inventoryItem: { include: { product: true, batch: true } } } },
        },
      });
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record egg packing.";
    const status = message.includes("STOCK_SHORT") || message.includes("STOCK_CONFLICT") || message.includes("WITHDRAWAL_BLOCKED") ? 409 : 400;
    return NextResponse.json({ error: message.replace(/^PACKING_[A-Z_]+: /, "") }, { status });
  }
}
