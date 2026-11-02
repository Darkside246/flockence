import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { calculateLifecycle } from "@/lib/lifecycle";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  const batches = await prisma.batch.findMany({
    where: {
      farmId: currentFarmId(),
      ...(batchId ? { id: batchId } : {}),
      OR: [{ productionType: "BROILER" }, { productionType: null, species: { not: "LAYER" } }],
    },
    include: {
      weights: { where: { liveOrDressed: "LIVE" }, orderBy: { date: "desc" }, take: 2 },
      dailyFlockChecks: { orderBy: { date: "desc" }, take: 1 },
      treatments: {
        where: {
          OR: [
            { status: "ACTIVE", withdrawalClearsAt: null },
            { withdrawalClearsAt: { gt: new Date() } },
          ],
        },
        orderBy: { withdrawalClearsAt: "asc" },
      },
    },
    orderBy: { startDate: "desc" }
  });
  return NextResponse.json(batches.map(batch => {
    const [latest, previous] = batch.weights;
    return {
      batch,
      lifecycle: calculateLifecycle({
        hatchDate: batch.hatchDate,
        purchaseDate: batch.purchaseDate,
        startDate: batch.startDate,
        targetAgeDays: batch.targetSlaughterAgeDays,
        decisionMode: batch.slaughterDecisionMode,
        targetLiveWeightKg: batch.targetLiveWeightKg ? Number(batch.targetLiveWeightKg) : null,
        latestLiveWeightKg: latest ? Number(latest.avgWeightKg) : null,
        latestWeightDate: latest?.date,
        previousLiveWeightKg: previous ? Number(previous.avgWeightKg) : null,
        previousWeightDate: previous?.date
      })
    };
  }));
}
