import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFormOriginResponse, accountRateLimitResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { offlineEventId } from "@/lib/offline-event";
import { isCalendarDateNotFuture, parseCalendarDate } from "@/lib/poultry-metrics.mjs";
import { prisma } from "@/lib/prisma";
import { penRecordDenied } from "@/lib/pen-access";

const category = "FIELD_INSPECTION";
const photoPrefix = "FIELD_INSPECTION_PHOTO::";
const receiptPrefix = "FIELD_INSPECTION_RECEIPT::";
const maxPhotoBytes = 256 * 1024;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
const form = z.strictObject({
  batchId: z.string().min(1).max(128),
  date: z.string(),
  notes: z.string().trim().max(2000),
  beddingIssue: z.boolean(),
  ventilationIssue: z.boolean(),
  waterChange: z.boolean(),
  feedChange: z.boolean(),
  temperatureC: z.number().min(-40).max(80).nullable(),
  humidityPercent: z.number().min(0).max(100).nullable(),
  photo: z.string().max(4 * Math.ceil(maxPhotoBytes / 3)).nullable(),
  offline: z.unknown(),
});

function validPhoto(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 5 && bytes.length <= maxPhotoBytes
    && bytes.toString("base64") === value
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const { farmId } = session.user;
  const photo = new URL(request.url).searchParams.get("photo");
  if (photo !== null) {
    if (!/^offline-[a-f0-9]{64}$/.test(photo)) return fail("Photo not found.", 404);
    const row = await prisma.setting.findUnique({
      where: { farmId_key: { farmId, key: photoPrefix + photo } }, select: { value: true },
    });
    if (!row || !validPhoto(row.value)) return fail("Photo not found.", 404);
    return new Response(new Uint8Array(Buffer.from(row.value, "base64")), { headers: {
      ...headers, "Content-Type": "image/jpeg", "Content-Disposition": 'attachment; filename="flock-inspection.jpg"',
      "Cross-Origin-Resource-Policy": "same-origin",
    } });
  }
  const records = await prisma.healthObservation.findMany({
    where: { farmId, category }, orderBy: { observedAt: "desc" }, take: 100,
    select: {
      id: true, observedAt: true, notes: true, beddingIssue: true, ventilationIssue: true, waterChange: true,
      feedChange: true, temperatureC: true, humidityPercent: true, imageUrl: true, batch: { select: { name: true } },
    },
  });
  return NextResponse.json(records, { headers });
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const { farmId } = session.user;
  try {
    const limit = await accountRateLimitResponse("field-inspections:" + session.user.id, 40, 15 * 60_000, "Too many inspection uploads. Try again shortly.");
    if (limit) return limit;
    const parsed = form.safeParse(await readAccountForm(request, 360 * 1024));
    if (!parsed.success) return fail("Check the inspection details and photo size.", 400);
    const { offline, photo, date: day, batchId, ...fields } = parsed.data;
    const penDenied = await penRecordDenied(session.user, { batchId });
    if (penDenied) return penDenied;
    const id = offlineEventId(request, offline, session.user);
    if (!id) return fail("Sign in as the original farm account to sync this inspection.", 403);
    if (photo && !validPhoto(photo)) return fail("Use a JPEG photo no larger than 256 KB.", 400);
    if (!photo && !fields.notes && fields.temperatureC === null && fields.humidityPercent === null
      && !fields.beddingIssue && !fields.ventilationIssue && !fields.waterChange && !fields.feedChange) {
      return fail("Enter an observation, reading or photo.", 400);
    }
    const date = parseCalendarDate(day);
    if (!date || !isCalendarDateNotFuture(date)) return fail("Use a current or historical inspection date.", 400);
    const batch = await prisma.batch.findFirst({ where: { id: batchId, farmId }, select: { startDate: true } });
    if (!batch) return fail("Flock not found.", 404);
    if (day < batch.startDate.toISOString().slice(0, 10)) return fail("The inspection cannot predate this flock.", 400);
    const receiptKey = receiptPrefix + id;
    const hash = createHash("sha256").update(JSON.stringify([batchId, day, fields, photo])).digest("hex");
    const result = await prisma.$transaction(async tx => {
      const lock = photoPrefix + farmId;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
      const receipt = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: receiptKey } }, select: { value: true } });
      if (receipt) return receipt.value === hash ? "saved" : "conflict";
      if (photo && await tx.setting.count({ where: { farmId, key: { startsWith: photoPrefix } } }) >= 100) return "photo-limit";
      await tx.healthObservation.create({ data: {
        id, farmId, batchId, observedAt: date, symptom: "Flock inspection", category, severity: "LOW",
        affectedCount: 0, ...fields, notes: fields.notes || null,
        imageUrl: photo ? "/api/offline/inspections?photo=" + id : null,
      } });
      await tx.setting.create({ data: { farmId, key: receiptKey, value: hash } });
      if (photo) await tx.setting.create({ data: { farmId, key: photoPrefix + id, value: photo } });
      return "saved";
    });
    if (result === "conflict") return fail("This inspection already synced with different details.", 409);
    if (result === "photo-limit") return fail("The farm has reached its inspection photo limit. The draft remains on this device.", 409);
    return NextResponse.json({ id }, { status: 201, headers });
  } catch {
    return fail("Could not sync this inspection. It remains queued on your device.", 503);
  }
}

export async function DELETE(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const limit = await accountRateLimitResponse("inspection-photo-delete:" + session.user.id, 20, 15 * 60_000, "Too many changes. Try again shortly.");
  if (limit) return limit;
  const data = await readAccountForm(request);
  if (typeof data?.id !== "string" || !/^offline-[a-f0-9]{64}$/.test(data.id)) return fail("Choose a photo.", 400);
  const { id } = data;
  const { farmId } = session.user;
  try {
    const removed = await prisma.$transaction(async tx => {
      const lock = photoPrefix + farmId;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
      const record = await tx.healthObservation.findFirst({ where: { id, farmId, category }, select: { imageUrl: true } });
      if (!record?.imageUrl) return false;
      await tx.healthObservation.update({ where: { id, farmId }, data: { imageUrl: null } });
      await tx.setting.deleteMany({ where: { farmId, key: photoPrefix + id } });
      await tx.auditLog.create({ data: { farmId, userId: session.user.id,
        action: "FIELD_INSPECTION_PHOTO_REMOVED", entity: "HealthObservation", entityId: id } });
      return true;
    });
    return removed ? NextResponse.json({ removed: true }, { headers }) : fail("Photo not found.", 404);
  } catch {
    return fail("Could not remove this photo.", 503);
  }
}
