import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { compareVisionAssessments } from "@/lib/vision-assessment";

export const runtime = "nodejs";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const access = await currentUserOrResponse(request);
  if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  const pair = z.tuple([id, id]).safeParse([params.get("earlier"), params.get("later")]);
  if (!pair.success || pair.data[0] === pair.data[1]) {
    return NextResponse.json({ error: "Choose two different inspections." }, { status: 400, headers });
  }
  const rows = await prisma.healthObservation.findMany({
    where: { farmId: access.user.farmId, id: { in: pair.data }, category: { startsWith: "VISION:" } },
    select: { id: true, observedAt: true, batchId: true, visionAssessment: true },
  });
  if (rows.length !== 2) return NextResponse.json({ error: "Inspection not found." }, { status: 404, headers });
  const result = compareVisionAssessments(rows[0], rows[1]);
  if (!result) return NextResponse.json({
    error: "Choose two structured inspections with the same camera, batch, focus and model.",
  }, { status: 422, headers });
  return NextResponse.json(result, { headers });
}
