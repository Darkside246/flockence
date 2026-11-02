import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { verifyOriyaSignature } from "@/lib/oriya-link.mjs";
import { runAsFarm } from "@/lib/farm-scope";
import { platformSecret, saveFarmLink } from "@/lib/oriya-farm-link";
import { readProvisionRequest } from "@/lib/oriya-account.mjs";

export const runtime = "nodejs";

/**
 * Oriya sets up a farm here (one account for Oriya and Flockence, 2026-11-02). Signed with the platform secret over
 * the exact body (5-minute window), each request id once, at most 10 a minute. Creates or renames the farm for the
 * Oriya business and keeps its link key (encrypted). Answers with the farm id only.
 */
export async function POST(request: Request) {
  const secret = platformSecret();
  if (!secret) return NextResponse.json({ error: "NOT_SET_UP" }, { status: 503 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length === 0 || raw.length > 4096) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const signed = verifyOriyaSignature(secret, request.headers.get("x-oriya-timestamp"), request.headers.get("x-oriya-signature"), raw);
  if (!signed.ok) return NextResponse.json({ error: signed.reason }, { status: 401 });
  const limit = await checkRateLimit("oriya:provision", 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  const ask = readProvisionRequest(body);
  if (!ask) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return runAsFarm(ask.farmId, async () => {
    // Each setup request once (kept per farm).
    const seen = await prisma.setting.findUnique({ where: { farmId_key: { farmId: ask.farmId, key: `ORIYA_PROVISION::${ask.requestId}` } } }).catch(() => null);
    if (seen) return NextResponse.json({ error: "ALREADY_RECEIVED" }, { status: 409 });
    await prisma.farm.upsert({ where: { id: ask.farmId }, create: { id: ask.farmId, name: ask.farmName, currency: "BBD" }, update: { name: ask.farmName } });
    await prisma.setting.create({ data: { farmId: ask.farmId, key: `ORIYA_PROVISION::${ask.requestId}`, value: new Date().toISOString() } });
    await prisma.setting.upsert({
      where: { farmId_key: { farmId: ask.farmId, key: "ORIYA_BUSINESS_ID" } },
      create: { farmId: ask.farmId, key: "ORIYA_BUSINESS_ID", value: ask.businessId }, update: { value: ask.businessId },
    });
    if (!(await saveFarmLink(ask.link))) return NextResponse.json({ error: "NOT_SET_UP" }, { status: 503 });
    return NextResponse.json({ farmId: ask.farmId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
