import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { recordInventoryMovement } from "@/lib/inventory-ledger";
import { validateEggCollectionInput, isCollectionDateWithinWithdrawal, isCalendarDateNotFuture } from "@/lib/poultry-metrics.mjs";
import { condemnLayerEggLotsForWithdrawal } from "@/lib/layer-withdrawal";
import { lockFlockOperations } from "@/lib/poultry-lock";

const GRADE_LABELS = {
  SMALL: "Small",
  MEDIUM: "Medium",
  LARGE: "Large",
  EXTRA_LARGE: "Extra Large",
  JUMBO: "Jumbo",
  UNGRADED: "Ungraded",
} as const;
type EggGrade = keyof typeof GRADE_LABELS;
const GRADES = Object.keys(GRADE_LABELS) as EggGrade[];

function collectionDate(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("A valid collection date is required.");
  const date = new Date(text + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("Collection date is invalid.");
  return date;
}

function isLayer(batch: { productionType: string | null; species: string }) {
  return batch.productionType === "LAYER" || batch.species.toUpperCase() === "LAYER";
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  const rows = await prisma.eggCollection.findMany({
    where: {
      farmId: currentFarmId(),
      ...(batchId ? { batchId } : {}),
      batch: { farmId: currentFarmId(), OR: [{ productionType: "LAYER" }, { productionType: null, species: "LAYER" }] },
    },
    include: {
      batch: true,
      grades: { include: { inventoryItem: { include: { product: true } } }, orderBy: { grade: "asc" } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const batchId = String(input.batchId ?? "").trim();
    if (!batchId) return NextResponse.json({ error: "Select a layer flock." }, { status: 400 });

    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId: currentFarmId() },
      select: { id: true, name: true, traceCode: true, species: true, productionType: true, layerStage: true, startDate: true },
    });
    if (!batch) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
    if (!isLayer(batch)) return NextResponse.json({ error: "Egg collection can only be recorded for a layer flock." }, { status: 409 });

    const date = collectionDate(input.date);
    if (!isCalendarDateNotFuture(date)) {
      return NextResponse.json({ error: "Egg collections can only be recorded for today or a historical date." }, { status: 400 });
    }
    if (date < new Date(batch.startDate.toISOString().slice(0, 10) + "T00:00:00.000Z")) {
      return NextResponse.json({ error: "The collection date cannot be before this flock was placed." }, { status: 400 });
    }
    const endOfCollectionDay = new Date(date.getTime() + 86400000);
    const [stageEventOnDate, nextStageEvent, anyStageEvents] = await Promise.all([
      prisma.layerStageEvent.findFirst({
        where: { farmId: currentFarmId(), batchId, date: { lt: endOfCollectionDay } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: { toStage: true },
      }),
      prisma.layerStageEvent.findFirst({
        where: { farmId: currentFarmId(), batchId, date: { gte: endOfCollectionDay } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: { fromStage: true },
      }),
      prisma.layerStageEvent.count({ where: { farmId: currentFarmId(), batchId } }),
    ]);
    const stageOnCollectionDate = stageEventOnDate?.toStage ??
      nextStageEvent?.fromStage ??
      (anyStageEvents === 0 ? batch.layerStage : null);
    if (stageOnCollectionDate !== "LAYING") {
      return NextResponse.json({
        error: stageOnCollectionDate
          ? `This flock was in the ${stageOnCollectionDate.replaceAll("_", " ").toLowerCase()} stage on the selected date. Egg collection is only available during the Laying stage.`
          : "No recorded Laying stage covers this collection date. Check the flock stage history before saving.",
      }, { status: 409 });
    }

    const validation = validateEggCollectionInput(input);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
    }
    const {
      liveHens, totalEggs, saleableEggs, dirtyEggs, crackedEggs,
      floorEggs, rejectedEggs, averageEggWeightG, notes, grades: gradeCounts,
    } = validation.value;

    const saved = await prisma.$transaction(async (tx) => {
      await lockFlockOperations(tx, [batchId]);

      const [currentBatch, currentStageEvent, nextStageEvent, currentStageEventCount] = await Promise.all([
        tx.batch.findFirst({
          where: { id: batchId, farmId: currentFarmId() },
          select: { layerStage: true },
        }),
        tx.layerStageEvent.findFirst({
          where: { farmId: currentFarmId(), batchId, date: { lt: endOfCollectionDay } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: { toStage: true },
        }),
        tx.layerStageEvent.findFirst({
          where: { farmId: currentFarmId(), batchId, date: { gte: endOfCollectionDay } },
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          select: { fromStage: true },
        }),
        tx.layerStageEvent.count({ where: { farmId: currentFarmId(), batchId } }),
      ]);
      if (!currentBatch) throw new Error("Flock not found.");
      const lockedStage = currentStageEvent?.toStage ??
        nextStageEvent?.fromStage ??
        (currentStageEventCount === 0 ? currentBatch.layerStage : null);
      if (lockedStage !== "LAYING") {
        throw new Error("LAYER_STAGE_CONFLICT: The flock is no longer in the Laying stage for this collection date. Refresh its stage history before saving.");
      }

      const withdrawalTreatments = await tx.treatment.findMany({
        where: {
          farmId: currentFarmId(),
          batchId,
          startedAt: { lt: endOfCollectionDay },
          OR: [
            { status: "ACTIVE", withdrawalClearsAt: null },
            { withdrawalClearsAt: { gt: date } },
          ],
        },
        select: { id: true, productName: true, startedAt: true, withdrawalClearsAt: true },
        orderBy: { withdrawalClearsAt: "asc" },
      });
      const existing = await tx.eggCollection.findUnique({
        where: { batchId_date: { batchId, date } },
        include: { grades: { include: { inventoryItem: true } } },
      });
      // Once an egg collection is blocked by a withdrawal, it must never become
      // saleable again merely because a treatment was later marked completed.
      const applicableWithdrawals = withdrawalTreatments.filter((treatment) =>
        isCollectionDateWithinWithdrawal(treatment.startedAt, treatment.withdrawalClearsAt, date)
      );
      const withdrawalBlocked = applicableWithdrawals.length > 0 || Boolean(existing?.withdrawalBlocked);
      const activeWithdrawalNotes = applicableWithdrawals.map((treatment) =>
        `${treatment.productName}: ${treatment.withdrawalClearsAt ? "withdrawal clears " + treatment.withdrawalClearsAt.toISOString() : "no clearance date recorded"}`
      ).join("; ");
      const withdrawalNotes = activeWithdrawalNotes || existing?.withdrawalNotes || null;

      const collection = existing
        ? await tx.eggCollection.update({
            where: { id: existing.id },
            data: { liveHens, totalEggs, saleableEggs, dirtyEggs, crackedEggs, floorEggs, rejectedEggs, withdrawalBlocked, withdrawalNotes, averageEggWeightG, notes },
          })
        : await tx.eggCollection.create({
            data: { farmId: currentFarmId(), batchId, date, liveHens, totalEggs, saleableEggs, dirtyEggs, crackedEggs, floorEggs, rejectedEggs, withdrawalBlocked, withdrawalNotes, averageEggWeightG, notes },
          });

      const oldGrades = new Map((existing?.grades ?? []).map((row) => [row.grade as EggGrade, row]));
      for (const row of gradeCounts) {
        const old = oldGrades.get(row.grade);
        const oldQuantity = old?.quantity ?? 0;
        const delta = row.quantity - oldQuantity;
        let inventoryItemId = old?.inventoryItemId ?? null;

        if (old?.inventoryItemId) {
          const inventory = old.inventoryItem;
          if (!inventory) throw new Error("Linked egg inventory lot is missing. Reconcile the lot before editing this collection.");
          const onHand = Number(inventory.quantity);
          if (delta < 0 && onHand + delta < 0) {
            throw new Error("EGG_STOCK_CORRECTION_BLOCKED: Some eggs from this collection have already been sold or used. Record a compensating stock adjustment before reducing the original collection.");
          }
          if (delta !== 0) {
            await tx.inventoryItem.update({
              where: { id: inventory.id },
              data: {
                quantity: { increment: delta },
                status: inventory.status === "CONDEMNED" ? "CONDEMNED" : onHand + delta <= 0 ? "DISPOSED" : inventory.status === "RESERVED" ? "RESERVED" : "AVAILABLE",
              },
            });
            await recordInventoryMovement(tx, {
              farmId: currentFarmId(),
              inventoryItemId: inventory.id,
              productId: inventory.productId,
              batchId,
              date,
              movementType: "ADJUSTMENT",
              quantity: delta,
              unit: "egg",
              referenceType: "EGG_COLLECTION_CORRECTION",
              referenceId: collection.id,
              notes: "Correction to graded egg collection. The original collection record is retained.",
            });
          }
        } else if (row.quantity > 0) {
          const productName = "Table Eggs - " + GRADE_LABELS[row.grade];
          const product = await tx.product.upsert({
            where: { farmId_name: { farmId: currentFarmId(), name: productName } },
            update: {},
            create: { farmId: currentFarmId(), name: productName, unit: "egg" },
          });
          const lotCode = `EGG-${batch.traceCode}-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${row.grade}`;
          const inventory = await tx.inventoryItem.create({
            data: {
              productId: product.id,
              batchId,
              quantity: row.quantity,
              costBasisMinor: 0,
              sellingPriceMinor: product.defaultPriceMinor,
              lotCode,
            },
          });
          inventoryItemId = inventory.id;
          await recordInventoryMovement(tx, {
            farmId: currentFarmId(),
            inventoryItemId: inventory.id,
            productId: product.id,
            batchId,
            date,
            movementType: "PRODUCTION",
            quantity: row.quantity,
            unit: "egg",
            referenceType: "EGG_COLLECTION",
            referenceId: collection.id,
            notes: "Graded eggs recorded from daily layer collection. Cost basis remains unallocated until layer cost accounting is configured.",
          });
        }

        await tx.eggCollectionGrade.upsert({
          where: { eggCollectionId_grade: { eggCollectionId: collection.id, grade: row.grade } },
          create: { eggCollectionId: collection.id, grade: row.grade, quantity: row.quantity, inventoryItemId },
          update: { quantity: row.quantity, inventoryItemId },
        });
      }

      if (withdrawalBlocked) {
        const summary = await condemnLayerEggLotsForWithdrawal(tx, {
          farmId: currentFarmId(),
          batchId,
          fromDate: date,
          toDate: endOfCollectionDay,
          reason: withdrawalNotes || "Eggs were collected during a medication withdrawal period.",
          actorUserId: session.user!.id,
          treatmentId: withdrawalTreatments[0]?.id ?? null,
        });
        if (summary.condemnedEggs > 0 || summary.condemnedCartons > 0) {
          await tx.auditLog.create({
            data: {
              farmId: currentFarmId(),
              userId: session.user!.id,
              action: "LAYER_WITHDRAWAL_STOCK_CONDEMNED",
              entity: "Batch",
              entityId: batchId,
              afterJson: JSON.stringify(summary),
            },
          });
        }
      }

      return tx.eggCollection.findUniqueOrThrow({
        where: { id: collection.id },
        include: { batch: true, grades: { include: { inventoryItem: { include: { product: true } } }, orderBy: { grade: "asc" } } },
      });
    });

    return NextResponse.json(saved, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save egg collection.";
    const conflict = message.startsWith("EGG_STOCK_CORRECTION_BLOCKED") || message.startsWith("LAYER_STAGE_CONFLICT");
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
