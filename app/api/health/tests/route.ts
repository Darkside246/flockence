import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await prisma.farm.upsert({ where: { id: FARM_ID }, update: {}, create: { id: FARM_ID, name: "Alchemy Farms", currency: "BBD" } });
  return NextResponse.json(await prisma.diagnosticTest.findMany({ where: { farmId: FARM_ID }, orderBy: { testDate: "desc" }, take: 200, include: { batch: true, healthCase: true } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await prisma.farm.upsert({ where: { id: FARM_ID }, update: {}, create: { id: FARM_ID, name: "Alchemy Farms", currency: "BBD" } });
    const input = await request.json();
    if (!input.testName || !input.testDate) return NextResponse.json({ error: "Test name and date are required." }, { status: 400 });
    const test = await prisma.diagnosticTest.create({ data: { farmId: FARM_ID, batchId: input.batchId || null, healthCaseId: input.healthCaseId || null, testDate: new Date(input.testDate), laboratory: input.laboratory || null, testName: input.testName, sampleType: input.sampleType || null, sampleCount: input.sampleCount ? Number(input.sampleCount) : null, status: input.status || "PENDING", resultSummary: input.resultSummary || null, confirmedCondition: input.confirmedCondition || null, reportReference: input.reportReference || null, reportUrl: input.reportUrl || null, notes: input.notes || null } });
    return NextResponse.json(test, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record test." }, { status: 400 }); }
}
