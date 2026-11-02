import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { healthGuidance } from "@/lib/health";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const cases = await prisma.healthCase.findMany({ where: { farmId: currentFarmId() }, orderBy: { openedAt: "desc" }, include: { batch: true, observations: { orderBy: { observedAt: "desc" } }, treatments: { orderBy: { startedAt: "desc" } }, diagnosticTests: { orderBy: { testDate: "desc" } } } });
  return NextResponse.json(cases);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input.title) return NextResponse.json({ error: "A problem title is required." }, { status: 400 });
    const latest = await prisma.healthCase.findFirst({ where: { farmId: currentFarmId() }, orderBy: { createdAt: "desc" }, select: { caseNumber: true } });
    const next = latest ? Number(latest.caseNumber.replace(/\D/g, "")) + 1 : 1;
    const caseNumber = `HC-${String(next).padStart(4, "0")}`;
    const guidance = healthGuidance(input.category, Array.isArray(input.symptoms) ? input.symptoms : []);
    const item = await prisma.healthCase.create({ data: { farmId: currentFarmId(), batchId: input.batchId || null, caseNumber, title: input.title, summary: input.summary || null, severity: input.severity || "MODERATE", confidence: input.confidence || "UNKNOWN", affectedCount: Math.max(0, Number(input.affectedCount || 0)), deathsCount: Math.max(0, Number(input.deathsCount || 0)), suspectedCause: input.suspectedCause || null, isolationRecommended: Boolean(input.isolationRecommended ?? guidance.urgent), movementRestricted: Boolean(input.movementRestricted ?? guidance.urgent), notes: input.notes || null } });
    return NextResponse.json({ ...item, guidance }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create health case." }, { status: 400 }); }
}
