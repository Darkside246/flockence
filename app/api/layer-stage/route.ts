import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { LayerStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { allowedNextLayerStages, calendarDateInTimeZone, isCalendarDateNotFuture, isValidLayerStageTransition, parseCalendarDate } from "@/lib/poultry-metrics.mjs";

const isLayer = (batch: { productionType: string | null; species: string }) =>
  batch.productionType === "LAYER" || (batch.productionType == null && batch.species.toUpperCase() === "LAYER");

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const { searchParams } = new URL(request.url);
  const batchId = String(searchParams.get("batchId") || "");
  if (!batchId) return NextResponse.json({ error: "A layer flock is required." }, { status: 400 });
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, farmId: currentFarmId() },
    select: { id: true, productionType: true, species: true, layerStage: true, status: true },
  });
  if (!batch) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  if (!isLayer(batch)) return NextResponse.json({ error: "This workflow is only available for layer flocks." }, { status: 409 });
  const history = await prisma.layerStageEvent.findMany({
    where: { farmId: currentFarmId(), batchId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ currentStage: batch.layerStage, history, allowedNextStages: allowedNextLayerStages(batch.layerStage) });
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const batchId = String(input.batchId || "");
    const toStage = String(input.toStage || "").toUpperCase();
    const reason = input.reason ? String(input.reason).trim().slice(0, 300) : null;
    const notes = input.notes ? String(input.notes).trim().slice(0, 2000) : null;
    if (!batchId || !(allowedNextLayerStages(null) as string[]).includes(toStage)) return NextResponse.json({ error: "Select a layer flock and a valid next production stage." }, { status: 400 });

    const batch = await prisma.batch.findFirst({
      where: { id: batchId, farmId: currentFarmId() },
      select: { id: true, productionType: true, species: true, layerStage: true, status: true },
    });
    if (!batch) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
    if (!isLayer(batch)) return NextResponse.json({ error: "Layer stages cannot be applied to a broiler flock." }, { status: 409 });
    if (batch.status === "CLOSED") return NextResponse.json({ error: "This flock is closed and cannot change production stage." }, { status: 409 });

    const allowed = allowedNextLayerStages(batch.layerStage);
    if (!isValidLayerStageTransition(batch.layerStage, toStage)) {
      return NextResponse.json({
        error: batch.layerStage
          ? `A flock at ${batch.layerStage.replaceAll("_", " ").toLowerCase()} cannot move directly to ${toStage.replaceAll("_", " ").toLowerCase()}.`
          : "Classify the current lifecycle stage for this existing layer flock.",
        allowedNextStages: allowed,
      }, { status: 409 });
    }

    const date = input.date
      ? parseCalendarDate(input.date)
      : parseCalendarDate(calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10));
    if (!date || !isCalendarDateNotFuture(date)) {
      return NextResponse.json({ error: "Stage changes must use a valid current or historical calendar date." }, { status: 400 });
    }
    const saved = await prisma.$transaction(async (tx) => {
      await lockFlockOperations(tx, [batch.id]);
      const latestEvent = await tx.layerStageEvent.findFirst({
        where: { farmId: currentFarmId(), batchId: batch.id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: { date: true },
      });
      if (latestEvent && date < latestEvent.date) {
        throw new Error("LAYER_STAGE_DATE_CONFLICT: A stage change cannot be backdated before the most recent stage event.");
      }

      if (batch.layerStage === "LAYING" && toStage !== "LAYING") {
        const affectedCollection = await tx.eggCollection.findFirst({
          where: { farmId: currentFarmId(), batchId: batch.id, date: { gte: date } },
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          select: { date: true },
        });
        if (affectedCollection) {
          throw new Error("LAYER_STAGE_EGG_CONFLICT: Correct or review egg collections on or after the proposed stage-change date before moving this flock out of Laying.");
        }
      }

      const changed = await tx.batch.updateMany({
        where: { id: batch.id, farmId: currentFarmId(), layerStage: batch.layerStage, status: batch.status },
        data: {
          layerStage: toStage as LayerStage,
          ...(toStage === "CLOSED" ? { status: "CLOSED" as const } : {}),
        },
      });
      if (changed.count !== 1) {
        throw new Error("LAYER_STAGE_CONFLICT: The flock stage changed in another session. Refresh the flock and try again.");
      }
      const updated = await tx.batch.findFirstOrThrow({ where: { id: batch.id, farmId: currentFarmId() } });
      const event = await tx.layerStageEvent.create({
        data: {
          farmId: currentFarmId(), batchId: batch.id,
          fromStage: batch.layerStage as LayerStage | null,
          toStage: toStage as LayerStage,
          date, reason, notes,
        },
      });
      return { batch: updated, event, allowedNextStages: allowedNextLayerStages(toStage) };
    });
    return NextResponse.json(saved, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the layer flock stage.";
    return NextResponse.json({ error: message }, { status: message.includes("CONFLICT") ? 409 : 400 });
  }
}
