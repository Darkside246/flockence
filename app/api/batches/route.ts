import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { reconcileLiveBirdsFromSnapshot } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batches = await prisma.batch.findMany({
    where: { farmId: FARM_ID },
    orderBy: { startDate: "desc" },
    include: {
      birdCounts: { where: { date: { lte: new Date() } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1 },
      mortalityEvents: true,
      slaughterEvents: true,
      layerStageEvents: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 },
    },
  });
  return NextResponse.json(batches.map((batch) => ({
    ...batch,
    liveBirdCount: reconcileLiveBirdsFromSnapshot(
      batch.initialChicks,
      batch.birdCounts[0] ?? null,
      [
        ...batch.mortalityEvents.map((event) => ({
          quantity: event.quantity,
          date: event.date,
          createdAt: event.createdAt,
        })),
        ...batch.slaughterEvents.map((event) => ({
          quantity: event.sentQuantity,
          date: event.date,
          createdAt: event.createdAt,
        })),
      ],
    ) ?? 0,
  })));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.name || (!input.startDate && !input.hatchDate && !input.purchaseDate) || !Number.isInteger(input.initialChicks) || input.initialChicks < 1) return NextResponse.json({ error: "Batch name, start date and positive chick count are required." }, { status: 400 });
    const startDate = new Date(input.startDate || input.hatchDate || input.purchaseDate);
    const hatchDate = input.hatchDate ? new Date(input.hatchDate) : null;
    const purchaseDate = input.purchaseDate ? new Date(input.purchaseDate) : null;
    const legacySpecies = String(input.species || "CHICKEN").trim().toUpperCase();
    const productionType = String(input.productionType || (legacySpecies === "LAYER" ? "LAYER" : "BROILER")).toUpperCase();
    if (productionType !== "BROILER" && productionType !== "LAYER") return NextResponse.json({ error: "Production type must be Broiler or Layer." }, { status: 400 });
    const species = legacySpecies === "LAYER" || legacySpecies === "BROILER_CHICKEN" ? "CHICKEN" : legacySpecies;
    if (productionType === "LAYER" && species !== "CHICKEN") return NextResponse.json({ error: "Layer production is currently supported for chicken flocks only." }, { status: 400 });
    const validLayerStages = ["CHICK", "GROWER", "PULLET", "PRE_LAY", "LAYING", "MOLT", "SPENT", "CLOSED"];
    const layerStage = productionType === "LAYER" ? String(input.layerStage || "CHICK").toUpperCase() : null;
    if (layerStage && !validLayerStages.includes(layerStage)) return NextResponse.json({ error: "Select a valid layer flock stage." }, { status: 400 });
    const targetSlaughterAgeDays = Math.max(1, Math.round(Number(input.targetSlaughterAgeDays ?? 42)));
    const lifecycleDate = hatchDate || purchaseDate || startDate;
    const expectedSlaughter = productionType === "BROILER"
      ? (input.expectedSlaughter ? new Date(input.expectedSlaughter) : new Date(lifecycleDate))
      : null;
    if (expectedSlaughter) expectedSlaughter.setUTCDate(expectedSlaughter.getUTCDate() + targetSlaughterAgeDays);
    const targetLiveWeightKg = productionType === "BROILER" && input.targetLiveWeightKg != null && input.targetLiveWeightKg !== "" ? Number(input.targetLiveWeightKg) : null;
    if (targetLiveWeightKg !== null && (!Number.isFinite(targetLiveWeightKg) || targetLiveWeightKg <= 0)) return NextResponse.json({ error: "Target live weight must be positive." }, { status: 400 });
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({ data: {
        farmId: FARM_ID, name: input.name, startDate, hatchDate, purchaseDate,
        species,
        productionType: productionType as "BROILER" | "LAYER",
        layerStage: layerStage as any,
        breed: input.breed ? String(input.breed).trim() : null,
        strain: input.strain ? String(input.strain).trim() : null,
        sex: input.sex ? String(input.sex).trim().toUpperCase() : null,
        hatchery: input.hatchery ? String(input.hatchery).trim() : null,
        sourceLot: input.sourceLot ? String(input.sourceLot).trim() : null,
        placementQuality: input.placementQuality ? String(input.placementQuality).trim().toUpperCase() : null,
        placementNotes: input.placementNotes ? String(input.placementNotes).trim() : null,
        lifecycleDateSource: hatchDate ? "HATCH_DATE" : purchaseDate ? "PURCHASE_DATE_ESTIMATE" : "START_DATE",
        initialChicks: input.initialChicks, chickCostMinor: Math.max(0, input.chickCostMinor ?? 0),
        expectedSlaughter, targetSlaughterAgeDays,
        slaughterDecisionMode: productionType === "BROILER" ? (input.slaughterDecisionMode || "AGE_OR_WEIGHT") : "MANUAL",
        targetLiveWeightKg, targetDressedWeightKg: null,
        supplierId: input.supplierId || null, status: "ACTIVE", recordStatus: "ACTUAL"
      } });
      await tx.birdCount.create({ data: { batchId: created.id, date: startDate, liveCount: input.initialChicks, note: "Initial count" } });
      if (layerStage) {
        await tx.layerStageEvent.create({
          data: { farmId: FARM_ID, batchId: created.id, fromStage: null, toStage: layerStage as any, date: startDate, reason: "INITIAL_SETUP" },
        });
      }
      return created;
    });
    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid batch" }, { status: 400 });
  }
}
