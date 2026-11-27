import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { rebuildBirdProjections } from "@/lib/flock-ledger";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { isCalendarDateNotFuture, parseCalendarDate, reconcileLiveBirdsFromSnapshot } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batches = await prisma.batch.findMany({
    where: { farmId: currentFarmId() },
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
    // The chick dealer: one of this farm's suppliers, or a new one named here (owner, 2026-11-02). A supplier id from
    // anywhere else is refused.
    const newDealerName = typeof input.newDealerName === "string" ? input.newDealerName.trim().slice(0, 80) : "";
    let supplierId: string | null = null;
    if (!newDealerName && input.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: String(input.supplierId), farmId: currentFarmId() }, select: { id: true } });
      if (!supplier) return NextResponse.json({ error: "That chick dealer was not found." }, { status: 400 });
      supplierId = supplier.id;
    }
    const chickCostMinor = Number(input.chickCostMinor ?? 0);
    if (!Number.isSafeInteger(chickCostMinor) || chickCostMinor < 0 || chickCostMinor > 1_000_000) return NextResponse.json({ error: "Enter a price per chick of 0 or more." }, { status: 400 });
    const batch = await prisma.$transaction(async (tx) => {
      if (newDealerName) {
        const existing = await tx.supplier.findFirst({ where: { farmId: currentFarmId(), name: { equals: newDealerName, mode: "insensitive" } }, select: { id: true } });
        supplierId = existing?.id ?? (await tx.supplier.create({ data: { farmId: currentFarmId(), name: newDealerName, category: "CHICKS", notes: "Chick dealer" }, select: { id: true } })).id;
      }
      const created = await tx.batch.create({ data: {
        farmId: currentFarmId(), name: input.name, startDate, hatchDate, purchaseDate,
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
        placementHouse: typeof input.placementHouse === "string" && input.placementHouse.trim() ? input.placementHouse.trim().slice(0, 80) : null,
        lifecycleDateSource: hatchDate ? "HATCH_DATE" : purchaseDate ? "PURCHASE_DATE_ESTIMATE" : "START_DATE",
        initialChicks: input.initialChicks, chickCostMinor,
        expectedSlaughter, targetSlaughterAgeDays,
        slaughterDecisionMode: productionType === "BROILER" ? (input.slaughterDecisionMode || "AGE_OR_WEIGHT") : "MANUAL",
        targetLiveWeightKg, targetDressedWeightKg: null,
        supplierId, status: "ACTIVE", recordStatus: "ACTUAL"
      } });
      await tx.birdCount.create({ data: { batchId: created.id, date: startDate, liveCount: input.initialChicks, note: "Initial count" } });
      if (layerStage) {
        await tx.layerStageEvent.create({
          data: { farmId: currentFarmId(), batchId: created.id, fromStage: null, toStage: layerStage as any, date: startDate, reason: "INITIAL_SETUP" },
        });
      }
      return created;
    });
    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid batch" }, { status: 400 });
  }
}

// Records that tie a flock to food safety, stock or sales. They are kept for traceability, so a flock that has any of
// them is closed rather than deleted. Daily checks, deaths, weights, feed use and the like go with the flock.
const KEPT_RECORDS: Record<string, string> = {
  slaughterEvents: "slaughter records", processingOutputs: "processing outputs", inventory: "stock lots", sales: "sales",
  treatments: "treatments", diagnosticTests: "diagnostic tests", eggCollections: "egg collections", eggPackRuns: "egg pack runs", transportEvents: "transport records",
};

export async function DELETE(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "Select a flock." }, { status: 400 });
  // The person must have typed DELETE; the screen asks for it and the server checks it too.
  if (params.get("confirm") !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  const result = await prisma.$transaction(async tx => {
    // Lock the parent before inspecting child rows so new records cannot race the deletion.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE id = ${id} AND "farmId" = ${session.user!.farmId} FOR UPDATE`;
    if (!locked.length) return { status: 404 as const };
    await lockFlockOperations(tx, [id]);
    const batch = await tx.batch.findUniqueOrThrow({ where: { id }, select: { name: true, _count: true } });
    const kept = Object.entries(KEPT_RECORDS).filter(([key]) => ((batch._count as Record<string, number>)[key] ?? 0) > 0).map(([, label]) => label);
    if (kept.length) return { status: 409 as const, name: batch.name, kept };
    await tx.batch.delete({ where: { id } });
    return { status: 200 as const };
  });
  if (result.status === 404) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  if (result.status === 409) return NextResponse.json({ error: `"${result.name}" has ${result.kept.join(", ")}. Those records trace food back to this flock, so it cannot be deleted. Close the flock instead; its history stays.` }, { status: 409 });
  return NextResponse.json({ deleted: true });
}

// Correct a flock's set-up (a wrong chick count, placement date, target). Saved daily records are not touched.
export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Choose a flock." }, { status: 400 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send the flock details to save." }, { status: 400 }); }
  const text = (value: unknown, max = 160) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const name = text(input.name, 120);
  if (!name) return NextResponse.json({ error: "A flock needs a name." }, { status: 400 });
  const initialChicks = Number(input.initialChicks);
  if (!Number.isInteger(initialChicks) || initialChicks < 1 || initialChicks > 1_000_000) return NextResponse.json({ error: "Enter the number of chicks placed as a whole number of 1 or more." }, { status: 400 });
  const startText = typeof input.startDate === "string" ? input.startDate : "";
  const startDate = parseCalendarDate(startText);
  if (!startDate || !isCalendarDateNotFuture(startText)) return NextResponse.json({ error: "Enter a placement date that is today or earlier." }, { status: 400 });
  const optionalDate = (value: unknown) => (value == null || value === "" ? null : typeof value === "string" ? parseCalendarDate(value) ?? undefined : undefined);
  const hatchDate = optionalDate(input.hatchDate);
  const purchaseDate = optionalDate(input.purchaseDate);
  if (hatchDate === undefined || purchaseDate === undefined) return NextResponse.json({ error: "Hatch and purchase dates must be real dates." }, { status: 400 });
  const chickCostMinor = input.chickCostMinor == null ? null : Number(input.chickCostMinor);
  if (chickCostMinor !== null && (!Number.isSafeInteger(chickCostMinor) || chickCostMinor < 0 || chickCostMinor > 1_000_000)) return NextResponse.json({ error: "Enter a price per chick of 0 or more." }, { status: 400 });

  const outcome = await prisma.$transaction(async tx => {
    await lockFlockOperations(tx, [id]);
    const flock = await tx.batch.findFirst({ where: { id, farmId: currentFarmId() }, include: {
      mortalityEvents: { select: { quantity: true, date: true } }, slaughterEvents: { select: { sentQuantity: true, date: true } },
      weights: { select: { date: true } }, dailyFlockChecks: { select: { date: true } }, birdCounts: true, layerStageEvents: true,
    } });
    if (!flock) return { error: "Flock not found.", status: 404 };
    if (flock.status === "CLOSED") return { error: "This flock is closed. Its set-up can no longer be changed.", status: 409 };
    const isLayer = flock.productionType === "LAYER" || String(flock.species).toUpperCase() === "LAYER";
    const accounted = flock.mortalityEvents.reduce((sum, row) => sum + row.quantity, 0) + flock.slaughterEvents.reduce((sum, row) => sum + row.sentQuantity, 0);
    // Birds added later count too: placed + added must cover every bird lost or sent.
    const added = (await tx.birdMovement.aggregate({ where: { batchId: id, type: "ADDITION", voidedAt: null }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    if (initialChicks + added < accounted) return { error: `${accounted} birds are already recorded as lost or sent for processing${added ? ` and ${added} were added later` : ""}, so fewer than ${accounted - added} chicks cannot have been placed.`, status: 409 };
    const earliest = [...flock.mortalityEvents, ...flock.slaughterEvents, ...flock.weights, ...flock.dailyFlockChecks].map(row => row.date.getTime());
    if (earliest.length && startDate.getTime() > Math.min(...earliest)) return { error: "The placement date cannot be later than records already saved for this flock. Change or remove those records first.", status: 409 };

    let targetSlaughterAgeDays = flock.targetSlaughterAgeDays;
    let targetLiveWeightKg = flock.targetLiveWeightKg;
    let expectedSlaughter = flock.expectedSlaughter;
    if (!isLayer) {
      targetSlaughterAgeDays = Math.round(Number(input.targetSlaughterAgeDays ?? flock.targetSlaughterAgeDays ?? 42));
      if (!Number.isInteger(targetSlaughterAgeDays) || targetSlaughterAgeDays < 1 || targetSlaughterAgeDays > 365) return { error: "Target age at harvest must be between 1 and 365 days.", status: 400 };
      if (input.targetLiveWeightKg === null || input.targetLiveWeightKg === "") targetLiveWeightKg = null;
      else if (input.targetLiveWeightKg !== undefined) {
        const weight = Number(input.targetLiveWeightKg);
        if (!Number.isFinite(weight) || weight <= 0 || weight > 20) return { error: "Target live weight must be a positive number of kilograms.", status: 400 };
        targetLiveWeightKg = weight as unknown as typeof targetLiveWeightKg;
      }
      expectedSlaughter = new Date(hatchDate ?? purchaseDate ?? startDate);
      expectedSlaughter.setUTCDate(expectedSlaughter.getUTCDate() + targetSlaughterAgeDays);
    }
    await tx.batch.update({ where: { id }, data: {
      name, initialChicks, startDate, hatchDate, purchaseDate, targetSlaughterAgeDays, targetLiveWeightKg, expectedSlaughter,
      lifecycleDateSource: hatchDate ? "HATCH_DATE" : purchaseDate ? "PURCHASE_DATE_ESTIMATE" : "START_DATE",
      breed: text(input.breed), strain: text(input.strain), hatchery: text(input.hatchery), sourceLot: text(input.sourceLot), placementNotes: text(input.placementNotes, 500), placementHouse: text(input.placementHouse, 80),
      ...(chickCostMinor !== null ? { chickCostMinor } : {}),
    } });
    // The first bird count and layer stage are the flock's own set-up rows, so they follow the corrected values.
    // Counts the system worked out (the first count, and the ones calculated after each loss) move with a corrected chick
    // number. A head count typed in from a daily check is a real count of the birds, so it is left alone.
    const delta = initialChicks - flock.initialChicks;
    for (const row of flock.birdCounts.filter(count => count.note === "Initial count")) await tx.birdCount.update({ where: { id: row.id }, data: { date: startDate, liveCount: initialChicks } });
    // The worked-out counts are rebuilt from the events rather than shifted, so they can never drift from the ledger.
    if (delta !== 0) await rebuildBirdProjections(tx, id);
    for (const row of flock.layerStageEvents.filter(event => event.reason === "INITIAL_SETUP")) await tx.layerStageEvent.update({ where: { id: row.id }, data: { date: startDate } });
    return { ok: true as const };
  });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ updated: true });
}

export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({error:"Choose a flock."},{status:400});
  const result = await prisma.$transaction(async tx => {
    await lockFlockOperations(tx,[id]);
    const flock = await tx.batch.findFirst({where:{id,farmId:currentFarmId()},include:{
      birdCounts:{where:{date:{lte:new Date()}},orderBy:[{date:"desc"},{createdAt:"desc"}],take:1},
      mortalityEvents:true,slaughterEvents:true,
    }});
    if (!flock) return 404;
    if (flock.status === "CLOSED") return 200;
    const count=reconcileLiveBirdsFromSnapshot(flock.initialChicks,flock.birdCounts[0] ?? null,[
      ...flock.mortalityEvents.map(e=>({date:e.date,createdAt:e.createdAt,quantity:e.quantity})),
      ...flock.slaughterEvents.map(e=>({date:e.date,createdAt:e.createdAt,quantity:e.sentQuantity}))]);
    if (flock.productionType === "LAYER" || flock.species === "LAYER" || flock.status !== "ACTIVE" || count !== 0) return 409;
    await tx.batch.update({where:{id},data:{status:"CLOSED"}});
    return 200;
  });
  if (result!==200) return NextResponse.json({error:result===404?"Flock not found.":"Record the final bird movements before closing a broiler flock. For layers, use the stage workflow."},{status:result});
  return NextResponse.json({closed:true});
}
