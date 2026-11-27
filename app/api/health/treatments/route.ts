import { createHash } from "node:crypto";
import { z } from "zod";
import { offlineEventId } from "@/lib/offline-event";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { condemnLayerEggLotsForWithdrawal } from "@/lib/layer-withdrawal";
import { lockFlockOperations } from "@/lib/poultry-lock";

const offlineTreatment = z.strictObject({
  batchId: z.string().min(1).max(128),
  productName: z.string().trim().min(1).max(160),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  clearsOn: z.string().nullable(),
  notes: z.string().trim().max(1000),
  offline: z.unknown(),
});

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await prisma.farm.upsert({ where: { id: currentFarmId() }, update: {}, create: { id: currentFarmId(), name: "Alchemy Farms", currency: "BBD" } });
  return NextResponse.json(await prisma.treatment.findMany({ where: { farmId: currentFarmId() }, orderBy: { startedAt: "desc" }, take: 200, include: { batch: true, healthCase: true } }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await prisma.farm.upsert({ where: { id: currentFarmId() }, update: {}, create: { id: currentFarmId(), name: "Alchemy Farms", currency: "BBD" } });
    const input = await request.json();
    const syncId = input.offline === undefined ? undefined : offlineEventId(request, input.offline, session.user);
    if (syncId === null) return NextResponse.json({ error: "Sign in as the original farm account to sync this treatment." }, { status: 403 });
    const checked = syncId ? offlineTreatment.safeParse(input) : null;
    if (checked && !checked.success) return NextResponse.json({ error: "Check the offline treatment details." }, { status: 400 });
    const offline = checked?.data;
    if (!input.productName || !input.startedAt) return NextResponse.json({ error: "Treatment name and start date are required." }, { status: 400 });
    const startedAt = offline ? parseCalendarDate(offline.startedAt) : new Date(input.startedAt);
    if (!startedAt || Number.isNaN(startedAt.getTime()) || (offline && !isCalendarDateNotFuture(startedAt))) return NextResponse.json({ error: "Treatment start date is invalid." }, { status: 400 });
    const days = input.withdrawalDays == null || input.withdrawalDays === "" ? 0 : Number(input.withdrawalDays);
    if (!Number.isSafeInteger(days) || days < 0 || days > 3650) {
      return NextResponse.json({ error: "Withdrawal days must be a whole number between 0 and 3,650." }, { status: 400 });
    }
    const endedAt = offline ? (offline.endedAt ? parseCalendarDate(offline.endedAt) : null) : input.endedAt ? new Date(input.endedAt) : null;
    if ((offline?.endedAt && (!endedAt || !isCalendarDateNotFuture(endedAt)))
      || (endedAt && (Number.isNaN(endedAt.getTime()) || endedAt < startedAt))) {
      return NextResponse.json({ error: "Treatment end date must be valid and cannot be before its start date." }, { status: 400 });
    }
    let batch = null;
    if (input.batchId) {
      batch = await prisma.batch.findFirst({
        where: { id: String(input.batchId), farmId: currentFarmId() },
        select: { id: true, productionType: true, species: true, startDate: true },
      });
      if (!batch) return NextResponse.json({ error: "Flock not found in this farm." }, { status: 404 });
    }
    if (offline && (!batch || offline.startedAt < batch.startDate.toISOString().slice(0, 10))) {
      return NextResponse.json({ error: "The treatment date must match a flock and cannot predate placement." }, { status: 400 });
    }
    let clearAt: Date | null = null;
    if (days > 0) {
      clearAt = new Date(startedAt);
      clearAt.setUTCDate(clearAt.getUTCDate() + days);
    }
    if (offline?.clearsOn) {
      clearAt = parseCalendarDate(offline.clearsOn);
      if (!clearAt || !endedAt || clearAt < endedAt) {
        return NextResponse.json({ error: "An explicit clearance date requires an end date and cannot be earlier than it." }, { status: 400 });
      }
    }
    const status = offline ? (!clearAt || clearAt > new Date() ? "ACTIVE" : "COMPLETED")
      : clearAt && clearAt > new Date() ? "ACTIVE" : (input.status || "COMPLETED");
    const receiptKey = syncId ? "OFFLINE_TREATMENT_RECEIPT::" + syncId : null;
    const payloadHash = offline ? createHash("sha256").update(JSON.stringify(offline)).digest("hex") : null;
    const treatment = await prisma.$transaction(async (tx) => {
      if (receiptKey) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))::text`;
        const receipt = await tx.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: receiptKey } } });
        if (receipt) {
          if (receipt.value !== payloadHash) throw new Error("OFFLINE_TREATMENT_CONFLICT");
          return { id: syncId };
        }
      }
      if (batch) await lockFlockOperations(tx, [batch.id]);
      const created = await tx.treatment.create({
        data: {
          ...(syncId ? { id: syncId } : {}),
          farmId: currentFarmId(),
          batchId: batch?.id || null,
          healthCaseId: input.healthCaseId || null,
          productName: String(input.productName).trim().slice(0, 160),
          activeIngredient: input.activeIngredient ? String(input.activeIngredient).trim().slice(0, 160) : null,
          reason: input.reason ? String(input.reason).trim().slice(0, 500) : null,
          startedAt,
          endedAt,
          status,
          doseText: input.doseText || null,
          route: input.route || null,
          frequency: input.frequency || null,
          durationDays: input.durationDays ? Number(input.durationDays) : null,
          withdrawalDays: days || null,
          withdrawalClearsAt: clearAt,
          veterinarian: input.veterinarian || null,
          instructions: input.instructions || null,
          notes: offline?.notes || input.notes || null,
        },
      });

      const isLayer = batch?.productionType === "LAYER" || (batch?.productionType == null && batch?.species.toUpperCase() === "LAYER");
      if (batch && isLayer && (days > 0 || created.status === "ACTIVE" || (offline && clearAt))) {
        const fromDate = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()));
        const summary = await condemnLayerEggLotsForWithdrawal(tx, {
          farmId: currentFarmId(),
          batchId: batch.id,
          fromDate,
          toDate: clearAt,
          reason: `${created.productName} medication withdrawal applies to eggs collected during this period. Those eggs and any cartons using them are not for sale.`,
          actorUserId: session.user!.id,
          treatmentId: created.id,
        });
        if (summary.collections > 0) {
          await tx.auditLog.create({
            data: {
              farmId: currentFarmId(),
              userId: session.user!.id,
              action: "LAYER_WITHDRAWAL_PERIOD_APPLIED",
              entity: "Treatment",
              entityId: created.id,
              afterJson: JSON.stringify(summary),
            },
          });
        }
      }
      if (receiptKey && payloadHash) {
        await tx.setting.create({ data: { farmId: currentFarmId(), key: receiptKey, value: payloadHash } });
      }
      return created;
    });
    return NextResponse.json(treatment, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "OFFLINE_TREATMENT_CONFLICT") {
      return NextResponse.json({ error: "This treatment already synced with different details." }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record treatment." }, { status: 400 });
  }
}
