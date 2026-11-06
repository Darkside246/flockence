import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { healthGuidance } from "@/lib/health";
import { ACTIONS_NEEDING_MANAGER, planAction, type ActionInput, type CaseAction, type CaseStatus } from "@/lib/health-case-lifecycle";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const cases = await prisma.healthCase.findMany({ where: { farmId: currentFarmId() }, orderBy: { openedAt: "desc" }, include: { batch: true, events: { orderBy: { createdAt: "desc" }, take: 100 }, observations: { orderBy: { observedAt: "desc" } }, treatments: { orderBy: { startedAt: "desc" } }, diagnosticTests: { orderBy: { testDate: "desc" } } } });
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
    const item = await prisma.healthCase.create({ data: { farmId: currentFarmId(), batchId: input.batchId || null, caseNumber, title: input.title, summary: input.summary || null, severity: input.severity || "MODERATE", confidence: input.confidence || "UNKNOWN", affectedCount: Math.max(0, Number(input.affectedCount || 0)), deathsCount: Math.max(0, Number(input.deathsCount || 0)), suspectedCause: input.suspectedCause || null, isolationRecommended: Boolean(input.isolationRecommended ?? guidance.urgent), movementRestricted: Boolean(input.movementRestricted ?? guidance.urgent), notes: input.notes || null, notifiable: input.notifiable === true, openedByUserId: session.user.id, events: { create: { farmId: currentFarmId(), userId: session.user.id, type: "OPENED", toStatus: "OPEN", note: [input.title, input.summary].filter(Boolean).join(". ").slice(0, 600) } } } });
    return NextResponse.json({ ...item, guidance }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create health case." }, { status: 400 }); }
}

const ACTIONS: readonly CaseAction[] = ["note", "monitor", "escalate", "resolve", "close", "reopen", "report"];

// Move a case through its life: add a note, start monitoring, escalate, resolve, close, reopen, or record a report to
// Veterinary Services. The rules are in lib/health-case-lifecycle.ts; every change leaves a dated line in the history.
export async function PATCH(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  let input: ActionInput & { action?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send what you want to do with the case." }, { status: 400 }); }
  const action = input.action as CaseAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  // Anyone who records on the farm can add to a case; deciding that it is resolved, closed or back again is the manager's call.
  const session = await currentUserOrRoleResponse(request, ACTIONS_NEEDING_MANAGER.includes(action) ? ["OWNER", "MANAGER"] : ["OWNER", "MANAGER", "WORKER"]);
  if (session.response) return session.response;
  if (!id) return NextResponse.json({ error: "Choose a case." }, { status: 400 });
  await ensureFarm();
  const today = calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);

  const result = await prisma.$transaction(async tx => {
    const current = await tx.healthCase.findFirst({
      where: { id, farmId: currentFarmId() },
      include: { diagnosticTests: { select: { status: true } }, treatments: { where: { status: "ACTIVE" }, select: { productName: true, withdrawalClearsAt: true } } },
    });
    if (!current) return { status: 404, error: "Case not found." };
    const plan = planAction({
      status: current.status as CaseStatus, severity: current.severity, affectedCount: current.affectedCount, deathsCount: current.deathsCount,
      movementRestricted: current.movementRestricted, isolationRecommended: current.isolationRecommended, outcome: current.outcome,
      notifiable: current.notifiable, reported: Boolean(current.reportedToAuthorityAt), pendingTests: current.diagnosticTests.filter(t => t.status === "PENDING").length,
    }, action, input, today);
    if (!plan.ok) return { status: 409, error: plan.error };
    await tx.healthCase.update({ where: { id }, data: plan.data as never });
    await tx.healthCaseEvent.create({ data: { farmId: currentFarmId(), healthCaseId: id, userId: session.user!.id, type: plan.event.type, fromStatus: plan.event.fromStatus, toStatus: plan.event.toStatus, note: plan.event.note } });
    // Withdrawal belongs to each treatment and keeps running after a case ends; say so when it is closed or resolved.
    const running = current.treatments.filter(t => t.withdrawalClearsAt && t.withdrawalClearsAt.toISOString().slice(0, 10) > today);
    return { status: 200, status_after: plan.status, withdrawalNote: running.length ? `Withdrawal is still running for ${running.map(t => t.productName).join(", ")}. Nothing from this flock should be sold for food until it clears.` : null };
  });
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, status: result.status_after, withdrawalNote: result.withdrawalNote });
}
