import { NextResponse } from "next/server";
import { z } from "zod";
import { currentFarmId, DEFAULT_FARM_ID } from "@/lib/farm-scope";
import { prisma } from "@/lib/prisma";
import { oriyaBaseUrl, platformSecret } from "@/lib/oriya-farm-link";
import { signOriyaBody } from "@/lib/oriya-link.mjs";

type State = "FREE" | "PREMIUM" | "EXISTING" | "UNAVAILABLE";
const cache = new Map<string, { state: Promise<State>; expires: number }>();
const resultSchema = z.object({ premium: z.boolean() });

async function linkedPlan(farmId: string, businessId: string): Promise<State> {
  const base = oriyaBaseUrl();
  const secret = platformSecret();
  if (!base || !secret) return "UNAVAILABLE";
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ purpose: "flockence.entitlement.v1", farmId, businessId });
  try {
    const response = await fetch(new URL("/api/public/flockence/entitlement", base), {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000),
      headers: { "Content-Type": "application/json", "X-Oriya-Timestamp": String(timestamp),
        "X-Oriya-Signature": signOriyaBody(secret, timestamp, body) },
      body,
    });
    if (!response.ok) return "UNAVAILABLE";
    const parsed = resultSchema.safeParse(await response.json());
    return parsed.success ? (parsed.data.premium ? "PREMIUM" : "FREE") : "UNAVAILABLE";
  } catch {
    return "UNAVAILABLE";
  }
}

export async function farmFeatureAccess() {
  const farmId = currentFarmId();
  const enforced = process.env.FLOCKENCE_ENFORCE_PREMIUM === "on";
  const settings = await prisma.setting.findMany({
    where: { farmId, key: { in: ["MEMBERSHIP_V1", "ORIYA_BUSINESS_ID"] } },
    select: { key: true, value: true },
  });
  const membership = settings.find((row) => row.key === "MEMBERSHIP_V1")?.value;
  const business = settings.find((row) => row.key === "ORIYA_BUSINESS_ID")?.value;
  if (membership === "FREE" && (!business || !enforced)) return { state: "FREE" as const, linked: Boolean(business) };
  if (!enforced) return { state: "EXISTING" as const, linked: Boolean(business) };
  if (!business) return {
    state: (farmId === DEFAULT_FARM_ID && process.env.FLOCKENCE_STANDALONE_PREMIUM === "on" ? "PREMIUM" : "FREE") as State,
    linked: false,
  };
  const cacheKey = JSON.stringify([farmId, business]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return { state: await cached.state, linked: true };
  if (cache.size >= 1000) cache.clear();
  const state = linkedPlan(farmId, business);
  cache.set(cacheKey, { state, expires: Date.now() + 30000 });
  return { state: await state, linked: true };
}

export async function premiumFeatureResponse() {
  const { state } = await farmFeatureAccess().catch(() => ({ state: "UNAVAILABLE" as const }));
  const headers = { "Cache-Control": "private, no-store" };
  if (state === "PREMIUM" || state === "EXISTING") return null;
  if (state === "FREE") return NextResponse.json({ error: "This feature requires Flockence Premium.", code: "UPGRADE_REQUIRED" }, { status: 403, headers });
  return NextResponse.json({ error: "The farm plan could not be verified. Try again shortly." }, { status: 503, headers });
}
