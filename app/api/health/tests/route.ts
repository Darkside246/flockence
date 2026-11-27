import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await prisma.farm.upsert({ where: { id: currentFarmId() }, update: {}, create: { id: currentFarmId(), name: "Alchemy Farms", currency: "BBD" } });
  return NextResponse.json(await prisma.diagnosticTest.findMany({ where: { farmId: currentFarmId() }, orderBy: { testDate: "desc" }, take: 200, include: { batch: true, healthCase: true } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await prisma.farm.upsert({ where: { id: currentFarmId() }, update: {}, create: { id: currentFarmId(), name: "Alchemy Farms", currency: "BBD" } });
    const input = await request.json();
    if (!input.testName || !input.testDate) return NextResponse.json({ error: "Test name and date are required." }, { status: 400 });
    const test = await prisma.diagnosticTest.create({ data: { farmId: currentFarmId(), batchId: input.batchId || null, healthCaseId: input.healthCaseId || null, testDate: new Date(input.testDate), laboratory: input.laboratory || null, testName: input.testName, sampleType: input.sampleType || null, sampleCount: input.sampleCount ? Number(input.sampleCount) : null, status: input.status || "PENDING", resultSummary: input.resultSummary || null, confirmedCondition: input.confirmedCondition || null, reportReference: input.reportReference || null, reportUrl: input.reportUrl || null, notes: input.notes || null } });
    return NextResponse.json(test, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record test." }, { status: 400 }); }
}

const RESULTS = ["NEGATIVE", "POSITIVE", "INCONCLUSIVE"];

// Record the result of a test that was waiting on the lab. A confirmed condition from a positive result is carried to the
// health case (if it has no diagnosis yet), and the case's history gets a line.
export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const id = new URL(request.url).searchParams.get("id");
  let input: { status?: string; resultSummary?: string; confirmedCondition?: string; reportReference?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send the result." }, { status: 400 }); }
  if (!id) return NextResponse.json({ error: "Choose a test." }, { status: 400 });
  if (!input.status || !RESULTS.includes(input.status)) return NextResponse.json({ error: "Choose negative, positive or inconclusive." }, { status: 400 });
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const result = await prisma.$transaction(async tx => {
    const test = await tx.diagnosticTest.findFirst({ where: { id, farmId: currentFarmId() } });
    if (!test) return { status: 404, error: "Test not found." };
    if (test.status !== "PENDING") return { status: 409, error: "This test already has a result." };
    const confirmedCondition = text(input.confirmedCondition, 200);
    await tx.diagnosticTest.update({ where: { id }, data: { status: input.status as never, resultSummary: text(input.resultSummary, 600), confirmedCondition, reportReference: text(input.reportReference, 120) } });
    if (test.healthCaseId) {
      const linked = await tx.healthCase.findFirst({ where: { id: test.healthCaseId, farmId: currentFarmId() }, select: { confirmedDiagnosis: true } });
      const carry = input.status === "POSITIVE" && confirmedCondition && linked && !linked.confirmedDiagnosis;
      await tx.healthCase.update({ where: { id: test.healthCaseId }, data: { lastActivityAt: new Date(), ...(carry ? { confirmedDiagnosis: confirmedCondition, confidence: "CONFIRMED" } : {}) } });
      await tx.healthCaseEvent.create({ data: { farmId: currentFarmId(), healthCaseId: test.healthCaseId, userId: session.user!.id, type: "RESULT", note: `${test.testName}: ${input.status!.toLowerCase()}.${confirmedCondition ? " " + confirmedCondition + "." : ""}${text(input.resultSummary, 300) ? " " + text(input.resultSummary, 300) : ""}` } });
    }
    return { status: 200 };
  });
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ recorded: true });
}
