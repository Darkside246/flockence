import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.healthObservation.findMany({ where: { farmId: FARM_ID }, orderBy: { observedAt: "desc" }, take: 200, include: { batch: true, healthCase: true } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.symptom || !input.observedAt) return NextResponse.json({ error: "Symptom and observation date are required." }, { status: 400 });
    const observation = await prisma.healthObservation.create({ data: { farmId: FARM_ID, batchId: input.batchId || null, healthCaseId: input.healthCaseId || null, observedAt: new Date(input.observedAt), symptom: input.symptom, category: input.category || null, affectedCount: Math.max(1, Number(input.affectedCount || 1)), severity: input.severity || "MODERATE", notes: input.notes || null, temperatureC: input.temperatureC === undefined || input.temperatureC === "" ? null : Number(input.temperatureC), humidityPercent: input.humidityPercent === undefined || input.humidityPercent === "" ? null : Number(input.humidityPercent), waterChange: typeof input.waterChange === "boolean" ? input.waterChange : null, feedChange: typeof input.feedChange === "boolean" ? input.feedChange : null, ventilationIssue: typeof input.ventilationIssue === "boolean" ? input.ventilationIssue : null, beddingIssue: typeof input.beddingIssue === "boolean" ? input.beddingIssue : null, imageUrl: input.imageUrl || null } });
    return NextResponse.json(observation, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record observation." }, { status: 400 }); }
}
