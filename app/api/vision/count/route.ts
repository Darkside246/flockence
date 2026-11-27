import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { RECORD_ROLES } from "@/lib/farm-roles";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { prisma } from "@/lib/prisma";
import { addCountSample } from "@/lib/vision-count-calibration";
import { birdsFromNotes, cameraFactor } from "@/lib/vision-glance-rules.mjs";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const form = z.strictObject({ observationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), actual: z.number().int().min(1).max(100000) });

/**
 * "How many birds are really in the pen?" for one camera check. The pair (Vision's count, the real count) teaches that
 * camera how much it misses (lib/vision-count-calibration.ts). Anyone who records may answer; records are not changed.
 */
export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, RECORD_ROLES);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const parsed = form.safeParse(await readAccountForm(request));
  if (!parsed.success) return NextResponse.json({ error: "Enter the number of birds as a whole number." }, { status: 400, headers });
  await ensureFarm();
  const row = await prisma.healthObservation.findFirst({
    where: { id: parsed.data.observationId, farmId: currentFarmId(), category: { startsWith: "VISION:" } },
    select: { id: true, notes: true, visionAssessment: true },
  });
  if (!row) return NextResponse.json({ error: "Inspection not found." }, { status: 404, headers });
  const a = (row.visionAssessment ?? {}) as { source?: { kind?: string; name?: string }; birds?: { visible?: number | null } };
  const counted = a.birds?.visible ?? birdsFromNotes(row.notes).visible;
  if (a.source?.kind !== "CAMERA" || !a.source.name) return NextResponse.json({ error: "Real counts teach a camera; this was an uploaded photo." }, { status: 409, headers });
  if (!counted) return NextResponse.json({ error: "Vision did not count birds in this picture." }, { status: 409, headers });
  const samples = await addCountSample(a.source.name, { counted, actual: parsed.data.actual, at: new Date().toISOString(), observationId: row.id });
  const factor = cameraFactor(samples);
  return NextResponse.json({
    camera: a.source.name, samples: samples.length, factor,
    message: factor ? `Thanks. ${a.source.name} usually shows about ${Math.round(100 / factor)}% of the birds; its next counts are adjusted (from ${samples.length} of your counts).`
      : "Thanks. One more real count and this camera's counts will be adjusted.",
  }, { headers });
}
