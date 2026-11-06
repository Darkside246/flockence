import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { prisma } from "@/lib/prisma";
import { assertHarvestAllowed } from "@/lib/withdrawal";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { liveBirdsOn, loadFlockLedger } from "@/lib/flock-ledger";
import { recordInventoryMovement } from "@/lib/inventory-ledger";

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

    const dressedDefinition = input.dressedDefinition === "CARCASS" || input.dressedDefinition === "CARCASS_WITH_GIBLETS" ? input.dressedDefinition : null;
    // Put the dressed birds in stock now, in the chosen store, instead of typing them again in the processing pack.
    const stockLocationId = input.stockNow === true && typeof input.storageLocationId === "string" && input.storageLocationId ? input.storageLocationId : null;
    if (input.stockNow === true && (!stockLocationId || dressedWeightKg == null || !dressedDefinition)) {
      return NextResponse.json({ error: "To put the birds in stock now, enter the total dressed weight, say whether it includes the giblets, and choose the store." }, { status: 400 });
    }
    const stockLocation = stockLocationId ? await prisma.storageLocation.findFirst({ where: { id: stockLocationId, farmId: currentFarmId(), active: true }, select: { id: true, name: true, type: true } }) : null;
    if (stockLocationId && !stockLocation) return NextResponse.json({ error: "That store was not found." }, { status: 400 });
    const storageOverride = typeof input.storageOverrideReason === "string" && input.storageOverrideReason.trim() ? input.storageOverrideReason.trim().slice(0, 300) : null;
    const chillingCompletedAt = input.chillingCompletedAt
      ? new Date(input.chillingCompletedAt)
      : null;
    if (chillingCompletedAt && Number.isNaN(chillingCompletedAt.getTime())) {
      return NextResponse.json({ error: "Chilling completion time is invalid." }, { status: 400 });
    }

    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId: currentFarmId() },
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

    // One id per press of Save: a retry after a dropped connection returns the first record, never a second slaughter.
    const key = typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId) ? "slaughter:" + input.submissionId : undefined;
    const event = await prisma.$transaction(async (tx) => {
      await lockFlockOperations(tx, [batch.id]);
      if (key) {
        const again = await tx.slaughterEvent.findUnique({ where: { id: key } });
        if (again) return again;
      }

      const currentBatch = await tx.batch.findFirst({
        where: { id: batch.id, farmId: currentFarmId() },
        select: { id: true, initialChicks: true },
      });
      if (!currentBatch) throw new Error("Batch not found.");

      const withdrawalBlockers = await tx.treatment.findMany({
        where: {
          farmId: currentFarmId(),
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

      const availableOnFarm = await liveBirdsOn(tx, batch.id, date);
      if (sentQuantity > availableOnFarm) {
        throw new Error(`Only ${availableOnFarm} birds were on the farm on that date, so ${sentQuantity} cannot be sent to slaughter.`);
      }
      const created = await tx.slaughterEvent.create({
        data: {
          ...(key ? { id: key } : {}),
          batchId: batch.id,
          date,
          sentQuantity,
          slaughtered,
          condemned,
          slaughterCostMinor,
          liveWeightKg,
          dressedWeightKg,
          dressedDefinition: dressedWeightKg != null ? dressedDefinition : null,
          chillingCompletedAt,
          notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null,
        },
      });

      const liveCount = Math.max(0, availableOnFarm - sentQuantity);
      await tx.birdCount.create({
        data: {
          batchId: batch.id,
          date,
          liveCount,
          note: "Calculated after slaughter and condemnation entry",
        },
      });

      const after = await loadFlockLedger(tx, batch.id);
      if (!after?.balance.ok) throw new Error(after?.balance.error ?? "This slaughter does not fit the flock's later records.");
      const fullyProcessed = after.balance.live === 0;
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

      // The store did not have room on the pre-slaughter check and someone chose to go ahead: keep who, when and why.
      // The dressed birds become one stock lot, linked to this slaughter, exactly once (a retry returned earlier).
      let stocked: { productName: string; quantity: number; weightKg: number; location: string } | null = null;
      if (stockLocation && dressedWeightKg != null && slaughtered > 0) {
        const productName = dressedDefinition === "CARCASS_WITH_GIBLETS" ? "Whole dressed chicken (giblets inside)" : "Whole dressed chicken";
        const product = await tx.product.upsert({ where: { farmId_name: { farmId: currentFarmId(), name: productName } }, update: {}, create: { farmId: currentFarmId(), name: productName, unit: "each" } });
        const lotCode = `${batch.name.replace(/[^A-Za-z0-9]+/g, "-")}-${date.toISOString().slice(0, 10)}-WHOLE`.slice(0, 120);
        const frozen = /freez/i.test(stockLocation.type) || /freez/i.test(stockLocation.name);
        const item = await tx.inventoryItem.create({ data: { productId: product.id, batchId: batch.id, quantity: slaughtered, weightKg: dressedWeightKg, storageLocationId: stockLocation.id, lotCode, packedAt: date, storageState: frozen ? "FROZEN" : "CHILLED" } });
        const output = await tx.processingOutput.create({ data: { batchId: batch.id, slaughterEventId: created.id, productName, category: "CARCASS", quantity: slaughtered, unit: "each", weightKg: dressedWeightKg, storageLocationId: stockLocation.id, lotCode, packedAt: date, storageState: frozen ? "FROZEN" : "CHILLED", status: "AVAILABLE", inventoryItemId: item.id, notes: "Put in stock when the slaughter was recorded." } });
        await recordInventoryMovement(tx, { farmId: currentFarmId(), inventoryItemId: item.id, productId: product.id, batchId: batch.id, date, movementType: "PRODUCTION", quantity: slaughtered, unit: "each", weightKg: dressedWeightKg, referenceType: "PROCESSING_OUTPUT", referenceId: output.id, toLocationId: stockLocation.id, notes: "Whole birds from slaughter" });
        stocked = { productName, quantity: slaughtered, weightKg: dressedWeightKg, location: stockLocation.name };
      }
      if (storageOverride) await tx.auditLog.create({ data: { farmId: currentFarmId(), userId: session.user!.id, action: "STORAGE_OVERRIDE", entity: "SlaughterEvent", entityId: created.id, afterJson: JSON.stringify({ reason: storageOverride, birds: sentQuantity }) } });
      return { ...created, liveBirdsNow: after.balance.live, stocked };
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
    where: { batch: { farmId: currentFarmId() } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { batch: true },
  }));
}
