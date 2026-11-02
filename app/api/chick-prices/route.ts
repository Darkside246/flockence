import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, FARM_ID } from "@/lib/operations";

/**
 * Chick prices for starting a flock (owner, 2026-11-02: "the default chick price is good but sometimes I have to go
 * by a different dealer and the price might be different"). The usual price is a farm setting; each dealer's price
 * is the one paid on the newest flock bought from that dealer. The form fills it in and it can still be changed.
 */
const DEFAULT_KEY = "CHICK_DEFAULT_PRICE_MINOR";
const FALLBACK_MINOR = 290;

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const [setting, suppliers, batches] = await Promise.all([
    prisma.setting.findUnique({ where: { farmId_key: { farmId: FARM_ID, key: DEFAULT_KEY } }, select: { value: true } }),
    prisma.supplier.findMany({ where: { farmId: FARM_ID }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.batch.findMany({
      where: { farmId: FARM_ID, supplierId: { not: null } }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      select: { supplierId: true, chickCostMinor: true, startDate: true }, take: 500,
    }),
  ]);
  const last = new Map<string, { priceMinor: number; date: Date }>();
  for (const b of batches) if (b.supplierId && !last.has(b.supplierId)) last.set(b.supplierId, { priceMinor: b.chickCostMinor, date: b.startDate });
  const stored = Number(setting?.value);
  return NextResponse.json({
    defaultPriceMinor: Number.isSafeInteger(stored) && stored >= 0 ? stored : FALLBACK_MINOR,
    dealers: suppliers.map((s) => ({ id: s.id, name: s.name, lastPriceMinor: last.get(s.id)?.priceMinor ?? null, lastBought: last.get(s.id)?.date.toISOString().slice(0, 10) ?? null })),
  }, { headers: { "Cache-Control": "no-store" } });
}

/** Sets the usual chick price (owner or manager). */
export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const input = await request.json().catch(() => null) as { defaultPriceMinor?: unknown } | null;
  const value = Number(input?.defaultPriceMinor);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) return NextResponse.json({ error: "Enter a price of 0 or more." }, { status: 400 });
  await prisma.setting.upsert({ where: { farmId_key: { farmId: FARM_ID, key: DEFAULT_KEY } }, create: { farmId: FARM_ID, key: DEFAULT_KEY, value: String(value) }, update: { value: String(value) } });
  return NextResponse.json({ defaultPriceMinor: value });
}
