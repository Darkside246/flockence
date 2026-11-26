import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedBody } from "@/lib/camera-gateway-http";
import { runAsFarm } from "@/lib/farm-scope";
import { farmLinkConfig } from "@/lib/oriya-farm-link";
import { verifyOriyaSignature } from "@/lib/oriya-link.mjs";
import { claimOriyaRequestId } from "@/lib/oriya";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { visionAssessmentSchema } from "@/lib/vision-assessment";
import { visionPens } from "@/lib/vision-pens";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };
const farmIdSchema = z.string().regex(/^[A-Za-z0-9_-]{3,64}$/);
const querySchema = z.strictObject({
  purpose: z.literal("flockence.pen-report.v1"),
  farmId: farmIdSchema,
  requestId: z.string().regex(/^oriya-[0-9a-f-]{36}$/),
  pen: z.string().trim().min(1).max(120).optional(),
});

const numberOrNull = (value: { toString(): string } | null) => value === null ? null : Number(value.toString());

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

export async function POST(request: Request) {
  const farmId = farmIdSchema.safeParse(request.headers.get("x-flockence-farm"));
  const raw = await boundedBody(request, 2048).catch(() => null);
  if (!farmId.success || !raw?.length) return respond({ error: "INVALID_REQUEST" }, 400);
  let json: unknown;
  try { json = JSON.parse(raw.toString("utf8")); } catch { return respond({ error: "INVALID_REQUEST" }, 400); }
  const parsed = querySchema.safeParse(json);
  if (!parsed.success || parsed.data.farmId !== farmId.data) return respond({ error: "INVALID_REQUEST" }, 400);
  const ask = parsed.data;
  return runAsFarm(ask.farmId, async () => {
    const config = await farmLinkConfig();
    if (!config || !verifyOriyaSignature(config.secret, request.headers.get("x-oriya-timestamp"),
      request.headers.get("x-oriya-signature"), raw).ok) return respond({ error: "LINK_UNAUTHORIZED" }, 401);
    const locked = await premiumFeatureResponse();
    if (locked) return locked;

    const limit = await checkRateLimit("oriya:pen-report:" + ask.farmId, 15, 60_000);
    if (!limit.allowed) return respond({ error: "RATE_LIMITED" }, 429);
    if (!(await claimOriyaRequestId(ask.requestId))) return respond({ error: "ALREADY_RECEIVED" }, 409);

    const pens = await visionPens();
    if (!ask.pen) return respond({ version: 1, kind: "PENS", pens: pens.slice(0, 40), more: pens.length > 40 });
    const target = ask.pen.toLowerCase();
    const candidates = pens.filter((pen) => pen.id === ask.pen || pen.name.toLowerCase() === target);
    if (!candidates.length) return respond({ error: "PEN_NOT_FOUND" }, 404);
    if (candidates.length > 1) return respond({ error: "AMBIGUOUS_PEN" }, 409);
    const [pen] = candidates;

    const [rows, latest] = await Promise.all([
      prisma.healthObservation.findMany({
        where: { category: { startsWith: "VISION:" }, visionAssessment: { path: ["pen", "id"], equals: pen.id } },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }], take: 3,
        select: { observedAt: true, visionAssessment: true },
      }),
      prisma.dailyFlockCheck.findFirst({
        where: { batch: { status: "ACTIVE" }, date: { lte: new Date() } }, orderBy: [{ date: "desc" }, { id: "desc" }],
        select: {
          date: true, liveCount: true, feedKg: true, waterLiters: true, temperatureC: true, humidityPercent: true,
          batch: { select: { name: true } },
        },
      }),
    ]);
    const inspections = rows.flatMap((row) => {
      const result = visionAssessmentSchema.safeParse(row.visionAssessment);
      if (!result.success) return [];
      const { summary, status, checks, confidence } = result.data;
      return [{ observedAt: row.observedAt.toISOString(), status, summary, confidence, checks: checks.slice(0, 3) }];
    });
    const farmContext = latest ? {
      observedAt: latest.date.toISOString(), batch: latest.batch.name.slice(0, 120), liveCount: latest.liveCount,
      feedKg: numberOrNull(latest.feedKg), waterLiters: numberOrNull(latest.waterLiters),
      temperatureC: numberOrNull(latest.temperatureC), humidityPercent: numberOrNull(latest.humidityPercent),
    } : null;
    return respond({ version: 1, kind: "PEN", pen, inspections, farmContext });
  });
}
