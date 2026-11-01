import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";

type TraceItem = {
  stage: string;
  type: string;
  occurredAt: string;
  recordedAt?: string | null;
  recordId: string;
  source: string;
  quantity?: number | null;
  unit?: string | null;
  details: Record<string, unknown>;
};

function n(value: unknown) {
  return value == null ? null : Number(value);
}

function add(items: TraceItem[], item: TraceItem) {
  items.push(item);
}

function asIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function lagHours(occurredAt: Date, recordedAt?: Date | null) {
  if (!recordedAt) return null;
  const hours = (recordedAt.getTime() - occurredAt.getTime()) / 3600000;
  return Number.isFinite(hours) ? Math.max(0, Math.round(hours * 10) / 10) : null;
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const traceCode = searchParams.get("code") || searchParams.get("traceCode");

    const batch = batchId
      ? await prisma.batch.findFirst({
          where: { id: batchId, farmId: FARM_ID },
          include: {
            mortalityEvents: true,
            feedPurchases: true,
            feedUsage: true,
            beddingPurchases: true,
            beddingUsage: true,
            expenses: true,
            transportEvents: { orderBy: { departureAt: "asc" } },
            slaughterEvents: { orderBy: { date: "asc" } },
            processingOutputs: { orderBy: { createdAt: "asc" }, include: { inventoryItem: true } },
            weights: { orderBy: { date: "asc" } },
            dailyFlockChecks: { orderBy: { date: "asc" } },
            healthCases: { orderBy: { openedAt: "asc" } },
            healthObservations: { orderBy: { observedAt: "asc" } },
            treatments: { orderBy: { startedAt: "asc" } },
            diagnosticTests: { orderBy: { testDate: "asc" } },
            manureRecords: { orderBy: { date: "asc" } },
            householdUses: { orderBy: { date: "asc" } },
          },
        })
      : traceCode
        ? await prisma.batch.findFirst({
            where: { farmId: FARM_ID, traceCode },
            include: {
              mortalityEvents: true,
              feedPurchases: true,
              feedUsage: true,
              beddingPurchases: true,
              beddingUsage: true,
              expenses: true,
              transportEvents: { orderBy: { departureAt: "asc" } },
              slaughterEvents: { orderBy: { date: "asc" } },
              processingOutputs: { orderBy: { createdAt: "asc" }, include: { inventoryItem: true } },
              weights: { orderBy: { date: "asc" } },
              dailyFlockChecks: { orderBy: { date: "asc" } },
              healthCases: { orderBy: { openedAt: "asc" } },
              healthObservations: { orderBy: { observedAt: "asc" } },
              treatments: { orderBy: { startedAt: "asc" } },
              diagnosticTests: { orderBy: { testDate: "asc" } },
              manureRecords: { orderBy: { date: "asc" } },
              householdUses: { orderBy: { date: "asc" } },
            },
          })
        : null;

    if (!batch) {
      return NextResponse.json({ error: "Batch not found. Supply a valid batchId or trace code." }, { status: 404 });
    }

    const [inventory, inventoryMovements, storageLocations, sales, transportExpenses] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { batchId: batch.id, product: { farmId: FARM_ID } },
        include: { product: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.inventoryMovement.findMany({
        where: { farmId: FARM_ID, batchId: batch.id },
        orderBy: { date: "asc" },
        include: { inventoryItem: { include: { product: true } } },
      }),
      prisma.storageLocation.findMany({
        where: { farmId: FARM_ID, inventoryItems: { some: { batchId: batch.id } } },
        include: { temperatureLogs: { orderBy: { date: "asc" } } },
      }),
      prisma.sale.findMany({
        where: { farmId: FARM_ID },
        include: { items: { include: { inventoryItem: { include: { product: true } } } }, customer: true },
        orderBy: { date: "asc" },
      }),
      prisma.transportationExpense.findMany({
        where: { farmId: FARM_ID, batchId: batch.id },
        orderBy: { date: "asc" },
      }),
    ]);

    const items: TraceItem[] = [];

    add(items, {
      stage: "CHICKS",
      type: "CHICK_REGISTRATION",
      occurredAt: batch.hatchDate?.toISOString() || batch.purchaseDate?.toISOString() || batch.startDate.toISOString(),
      recordedAt: batch.createdAt.toISOString(),
      recordId: batch.id,
      source: "Batch registration",
      quantity: batch.initialChicks,
      unit: "birds",
      details: {
        traceCode: batch.traceCode,
        batchName: batch.name,
        status: batch.status,
        species: batch.species,
        breed: batch.breed,
        strain: batch.strain,
        sex: batch.sex,
        hatchery: batch.hatchery,
        sourceLot: batch.sourceLot,
        hatchDate: asIso(batch.hatchDate),
        purchaseDate: asIso(batch.purchaseDate),
        placementQuality: batch.placementQuality,
        placementNotes: batch.placementNotes,
        chickCostMinorPerBird: batch.chickCostMinor,
        targetSlaughterAgeDays: batch.targetSlaughterAgeDays,
        targetLiveWeightKg: n(batch.targetLiveWeightKg),
        entryLagHours: lagHours(batch.hatchDate || batch.purchaseDate || batch.startDate, batch.createdAt),
      },
    });

    for (const x of batch.dailyFlockChecks) add(items, {
      stage: "FLOCK",
      type: "DAILY_FLOCK_CHECK",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Daily flock check",
      quantity: x.liveCount,
      unit: "live birds",
      details: {
        feedKg: n(x.feedKg),
        waterLiters: n(x.waterLiters),
        avgWeightKg: n(x.avgWeightKg),
        weightSampleQuantity: x.weightSampleQuantity,
        temperatureC: n(x.temperatureC),
        humidityPercent: n(x.humidityPercent),
        ammoniaPpm: n(x.ammoniaPpm),
        litterCondition: x.litterCondition,
        pantingObserved: x.pantingObserved,
        wingSpreadingObserved: x.wingSpreadingObserved,
        notes: x.notes,
        entryLagHours: lagHours(x.date, x.createdAt),
      },
    });

    for (const x of batch.weights) add(items, {
      stage: "GROWTH",
      type: "WEIGHT_RECORD",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Weight record",
      quantity: x.quantity,
      unit: "birds sampled",
      details: {
        avgWeightKg: n(x.avgWeightKg),
        scope: x.scope,
        liveOrDressed: x.liveOrDressed,
        entryLagHours: lagHours(x.date, x.createdAt),
      },
    });

    for (const x of batch.mortalityEvents) add(items, {
      stage: "FLOCK",
      type: "MORTALITY",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Mortality record",
      quantity: x.quantity,
      unit: "birds",
      details: { reason: x.reason, notes: x.notes, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.feedPurchases) add(items, {
      stage: "INPUTS",
      type: "FEED_PURCHASE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Feed purchase",
      quantity: Number(x.quantityBags),
      unit: "bags",
      details: { feedType: x.feedType, bagSizeKg: n(x.bagSizeKg), unitCostMinor: x.unitCostMinor, supplierId: x.supplierId, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.feedUsage) add(items, {
      stage: "INPUTS",
      type: "FEED_USAGE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Feed usage",
      quantity: Number(x.quantityKg),
      unit: "kg",
      details: { feedType: x.feedType, costMinor: x.costMinor, note: x.note, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.beddingPurchases) add(items, {
      stage: "INPUTS",
      type: "BEDDING_PURCHASE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Bedding purchase",
      quantity: Number(x.quantity),
      unit: x.unit,
      details: { material: x.material, unitCostMinor: x.unitCostMinor, supplierId: x.supplierId, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.beddingUsage) add(items, {
      stage: "INPUTS",
      type: "BEDDING_USAGE",
      occurredAt: x.date.toISOString(),
      recordedAt: null,
      recordId: x.id,
      source: "Bedding usage",
      quantity: Number(x.quantity),
      unit: x.unit,
      details: { material: x.material, costMinor: x.costMinor },
    });

    for (const x of batch.expenses) add(items, {
      stage: "COSTS",
      type: "BATCH_EXPENSE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Batch expense",
      quantity: x.amountMinor,
      unit: "minor currency units",
      details: { category: x.category, description: x.description, recordStatus: x.recordStatus, economicCost: x.economicCost, allocationMethod: x.allocationMethod, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of transportExpenses) add(items, {
      stage: "TRANSPORT",
      type: "TRANSPORT_EXPENSE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Transportation expense",
      quantity: x.actualCashMinor,
      unit: "minor currency units",
      details: { purpose: x.purpose, distanceKm: n(x.distanceKm), fuelMinor: x.fuelMinor, otherMinor: x.otherMinor, economicMinor: x.economicMinor, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.healthCases) add(items, {
      stage: "HEALTH",
      type: "HEALTH_CASE",
      occurredAt: x.openedAt.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Health case",
      quantity: x.affectedCount,
      unit: "affected birds",
      details: { caseNumber: x.caseNumber, status: x.status, severity: x.severity, confidence: x.confidence, title: x.title, suspectedCause: x.suspectedCause, confirmedDiagnosis: x.confirmedDiagnosis, movementRestricted: x.movementRestricted, entryLagHours: lagHours(x.openedAt, x.createdAt) },
    });

    for (const x of batch.healthObservations) add(items, {
      stage: "HEALTH",
      type: "HEALTH_OBSERVATION",
      occurredAt: x.observedAt.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Health observation",
      quantity: x.affectedCount,
      unit: "affected birds",
      details: { symptom: x.symptom, category: x.category, severity: x.severity, temperatureC: n(x.temperatureC), humidityPercent: n(x.humidityPercent), waterChange: x.waterChange, feedChange: x.feedChange, ventilationIssue: x.ventilationIssue, beddingIssue: x.beddingIssue, notes: x.notes, entryLagHours: lagHours(x.observedAt, x.createdAt) },
    });

    for (const x of batch.treatments) add(items, {
      stage: "HEALTH",
      type: "TREATMENT",
      occurredAt: x.startedAt.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Treatment record",
      quantity: x.durationDays,
      unit: x.durationDays == null ? null : "days",
      details: { productName: x.productName, activeIngredient: x.activeIngredient, reason: x.reason, endedAt: asIso(x.endedAt), status: x.status, withdrawalDays: x.withdrawalDays, withdrawalClearsAt: asIso(x.withdrawalClearsAt), veterinarian: x.veterinarian, entryLagHours: lagHours(x.startedAt, x.createdAt) },
    });

    for (const x of batch.diagnosticTests) add(items, {
      stage: "HEALTH",
      type: "DIAGNOSTIC_TEST",
      occurredAt: x.testDate.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Diagnostic test",
      quantity: x.sampleCount,
      unit: x.sampleCount == null ? null : "samples",
      details: { laboratory: x.laboratory, testName: x.testName, sampleType: x.sampleType, status: x.status, resultSummary: x.resultSummary, confirmedCondition: x.confirmedCondition, reportReference: x.reportReference, entryLagHours: lagHours(x.testDate, x.createdAt) },
    });

    for (const x of batch.transportEvents) add(items, {
      stage: "TRANSPORT",
      type: x.type,
      occurredAt: x.departureAt.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Transport event",
      quantity: x.birdsLoaded,
      unit: x.birdsLoaded == null ? null : "birds",
      details: { arrivalAt: asIso(x.arrivalAt), origin: x.origin, destination: x.destination, carrier: x.carrier, vehicle: x.vehicle, driverName: x.driverName, birdsArrived: x.birdsArrived, birdsDeadOnArrival: x.birdsDeadOnArrival, crateCount: x.crateCount, distanceKm: n(x.distanceKm), journeyMinutes: x.journeyMinutes, ambientTempC: n(x.ambientTempC), feedWithdrawalHours: n(x.feedWithdrawalHours), waterAvailable: x.waterAvailable, welfareCheckCompleted: x.welfareCheckCompleted, sanitationCompleted: x.sanitationCompleted, entryLagHours: lagHours(x.departureAt, x.createdAt) },
    });

    for (const x of batch.slaughterEvents) add(items, {
      stage: "HARVEST",
      type: "SLAUGHTER",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Slaughter event",
      quantity: x.slaughtered,
      unit: "birds",
      details: { sentQuantity: x.sentQuantity, slaughtered: x.slaughtered, condemned: x.condemned, slaughterCostMinor: x.slaughterCostMinor, liveWeightKg: n(x.liveWeightKg), dressedWeightKg: n(x.dressedWeightKg), chillingCompletedAt: asIso(x.chillingCompletedAt), notes: x.notes, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.processingOutputs) add(items, {
      stage: "PROCESSING",
      type: "PROCESSING_OUTPUT",
      occurredAt: x.packedAt?.toISOString() || x.createdAt.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Processing output",
      quantity: Number(x.quantity),
      unit: x.unit,
      details: { productName: x.productName, category: x.category, weightKg: n(x.weightKg), unitPriceMinor: x.unitPriceMinor, costBasisMinor: x.costBasisMinor, status: x.status, lotCode: x.lotCode, packedAt: asIso(x.packedAt), useByDate: asIso(x.useByDate), storageState: x.storageState, storageLocationId: x.storageLocationId, inventoryItemId: x.inventoryItemId, slaughterEventId: x.slaughterEventId, notes: x.notes },
    });

    for (const x of inventory) add(items, {
      stage: "INVENTORY",
      type: "INVENTORY_LOT_CREATED",
      occurredAt: x.createdAt.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Inventory lot",
      quantity: Number(x.quantity),
      unit: x.product.unit,
      details: { productName: x.product.name, weightKg: n(x.weightKg), status: x.status, lotCode: x.lotCode, packedAt: asIso(x.packedAt), useByDate: asIso(x.useByDate), storageState: x.storageState, storageLocationId: x.storageLocationId, sellingPriceMinor: x.sellingPriceMinor },
    });

    for (const x of inventoryMovements) add(items, {
      stage: "INVENTORY",
      type: "INVENTORY_MOVEMENT",
      occurredAt: x.date.toISOString(),
      recordedAt: null,
      recordId: x.id,
      source: "Inventory ledger",
      quantity: Number(x.quantity),
      unit: x.unit,
      details: { movementType: x.movementType, productName: x.inventoryItem?.product?.name || null, weightKg: n(x.weightKg), referenceType: x.referenceType, referenceId: x.referenceId, fromLocationId: x.fromLocationId, toLocationId: x.toLocationId, notes: x.notes },
    });

    for (const location of storageLocations) for (const x of location.temperatureLogs) add(items, {
      stage: "COLD_CHAIN",
      type: "STORAGE_TEMPERATURE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Storage temperature log",
      quantity: n(x.temperatureC),
      unit: "°C",
      details: { storageLocationId: location.id, storageLocation: location.name, measuredBy: x.measuredBy, temperatureTargetC: n(location.temperatureTargetC), temperatureMinC: n(location.temperatureMinC), temperatureMaxC: n(location.temperatureMaxC), notes: x.notes, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.manureRecords) add(items, {
      stage: "BYPRODUCTS",
      type: "MANURE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Manure / litter record",
      quantity: Number(x.quantity),
      unit: x.unit,
      details: { material: x.material, disposition: x.disposition, amountMinor: x.amountMinor, transportMinor: x.transportMinor, notes: x.notes, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    for (const x of batch.householdUses) add(items, {
      stage: "DISPOSITION",
      type: "HOUSEHOLD_USE",
      occurredAt: x.date.toISOString(),
      recordedAt: x.createdAt.toISOString(),
      recordId: x.id,
      source: "Household consumption",
      quantity: Number(x.quantity),
      unit: "units",
      details: { product: x.product, weightKg: n(x.weightKg), estimatedValueMinor: x.estimatedValueMinor, entryLagHours: lagHours(x.date, x.createdAt) },
    });

    const batchSales = sales.flatMap(s => s.items
      .filter(i => i.batchId === batch.id || i.inventoryItem?.batchId === batch.id)
      .map(i => ({ sale: s, item: i })));

    for (const { sale, item } of batchSales) add(items, {
      stage: "SOLD",
      type: "SALE",
      occurredAt: sale.date.toISOString(),
      recordedAt: sale.createdAt.toISOString(),
      recordId: sale.id,
      source: "Sale",
      quantity: Number(item.quantity),
      unit: "units",
      details: {
        description: item.description,
        weightKg: n(item.weightKg),
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.totalMinor,
        saleTotalMinor: sale.totalMinor,
        amountPaidMinor: sale.amountPaidMinor,
        paymentStatus: sale.paymentStatus,
        orderStatus: sale.orderStatus,
        fulfillmentMethod: sale.fulfillmentMethod,
        source: sale.source,
        customerName: sale.customerName,
        externalId: sale.externalId,
        inventoryItemId: item.inventoryItemId,
        entryLagHours: lagHours(sale.date, sale.createdAt),
      },
    });

    items.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() || (a.recordedAt ? new Date(a.recordedAt).getTime() : 0) - (b.recordedAt ? new Date(b.recordedAt).getTime() : 0));

    const mortality = batch.mortalityEvents.reduce((s, x) => s + x.quantity, 0);
    const slaughtered = batch.slaughterEvents.reduce((s, x) => s + x.slaughtered, 0);
    const condemned = batch.slaughterEvents.reduce((s, x) => s + x.condemned, 0);
    const birdAccounted = mortality + slaughtered + condemned;
    const birdVariance = batch.initialChicks - birdAccounted;
    const productsSoldQuantity = batchSales.reduce((s, x) => s + Number(x.item.quantity), 0);
    const salesRevenueMinor = batchSales.reduce((s, x) => s + x.item.totalMinor, 0);
    const finalInventoryQuantity = inventory.reduce((s, x) => s + (x.status === "AVAILABLE" || x.status === "RESERVED" ? Number(x.quantity) : 0), 0);

    const stages = [
      { key: "CHICKS", label: "Chicks registered", complete: true, count: 1 },
      { key: "FLOCK", label: "Flock cycle records", complete: batch.dailyFlockChecks.length > 0 || mortality > 0, count: batch.dailyFlockChecks.length + batch.mortalityEvents.length },
      { key: "GROWTH", label: "Growth / weights", complete: batch.weights.length > 0, count: batch.weights.length },
      { key: "HARVEST", label: "Harvest", complete: batch.slaughterEvents.length > 0, count: batch.slaughterEvents.length },
      { key: "PROCESSING", label: "Processing / product lots", complete: batch.processingOutputs.length > 0, count: batch.processingOutputs.length },
      { key: "SOLD", label: "Sales", complete: batchSales.length > 0, count: batchSales.length },
    ];

    const trace = {
      traceCode: batch.traceCode,
      batchId: batch.id,
      batchName: batch.name,
      status: batch.status,
      initialChicks: batch.initialChicks,
      lifecycleStart: (batch.hatchDate || batch.purchaseDate || batch.startDate).toISOString(),
      actualSlaughter: asIso(batch.actualSlaughter),
      birdReconciliation: {
        initialChicks: batch.initialChicks,
        mortality,
        slaughtered,
        condemned,
        accounted: birdAccounted,
        unaccountedOrRemaining: birdVariance,
        balanced: birdVariance === 0,
        note: birdVariance > 0 ? "These birds are not yet accounted for in mortality, slaughter or condemnation." : birdVariance < 0 ? "More birds are accounted than were registered. Review duplicate or excessive entries." : "All registered birds are accounted for.",
      },
      sales: {
        lineCount: batchSales.length,
        quantity: productsSoldQuantity,
        revenueMinor: salesRevenueMinor,
      },
      inventory: {
        lots: inventory.length,
        availableQuantity: finalInventoryQuantity,
      },
      stages,
      eventCount: items.length,
      items,
    };

    const format = searchParams.get("format");
    if (format === "csv") {
      const escape = (value: unknown) => {
        const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
        return "\"" + s.replaceAll("\"", "\"\"") + "\"";
      };
      const header = ["Occurred At", "Recorded At", "Stage", "Type", "Source", "Record ID", "Quantity", "Unit", "Details"];
      const csv = [header, ...items.map(x => [x.occurredAt, x.recordedAt || "", x.stage, x.type, x.source, x.recordId, x.quantity ?? "", x.unit || "", JSON.stringify(x.details)])]
        .map(row => row.map(escape).join(",")).join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trace-${batch.traceCode}.csv"` } });
    }

    return NextResponse.json(trace);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not build batch trace." }, { status: 400 });
  }
}
