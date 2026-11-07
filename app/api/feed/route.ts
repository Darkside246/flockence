import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { feedLabel } from "@/lib/feed-catalogue";

/**
 * A feed purchase: bags of a size, at a price per bag. How feed is bought is kept apart from how it is used: buying
 * 30 kg bags does not stop the farm recording use by the scoop or by the kilogram.
 */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const rows = await prisma.feedPurchase.findMany({ where: { farmId: currentFarmId() }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 50, include: { supplier: { select: { id: true, name: true } } } });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const bagSizeKg = Number(input.bagSizeKg);
    const quantityBags = Number(input.quantityBags);
    const unitCostMinor = Number(input.unitCostMinor);
    const farmId = currentFarmId();
    const product = input.feedProductId ? await prisma.feedProduct.findFirst({ where: { id: String(input.feedProductId), farmId } }) : null;
    if (input.feedProductId && !product) return NextResponse.json({ error: "That feed is not in the farm's catalogue." }, { status: 404 });
    const feedType = product ? feedLabel(product) : String(input.feedType || "").trim();
    if (!input.date || !feedType || !Number.isFinite(bagSizeKg) || bagSizeKg <= 0 || !Number.isFinite(quantityBags) || quantityBags <= 0 || !Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) {
      return NextResponse.json({ error: "Feed type, date, positive bag size, positive quantity and a valid non-negative cost are required." }, { status: 400 });
    }
    if (input.batchId) {
      const batch = await prisma.batch.findFirst({ where: { id: String(input.batchId), farmId }, select: { id: true } });
      if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    if (input.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: String(input.supplierId), farmId }, select: { id: true } });
      if (!supplier) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }
    // One id per press of Save: a retry after a dropped connection returns the first purchase, not a second one.
    const id = typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId) ? "feed:" + input.submissionId : undefined;
    if (id) {
      const again = await prisma.feedPurchase.findUnique({ where: { id } });
      if (again) return NextResponse.json({ ...again, repeated: true });
    }
    const row = await prisma.$transaction(async tx => {
      const created = await tx.feedPurchase.create({ data: { ...(id ? { id } : {}), farmId, batchId: input.batchId || null, date: new Date(input.date), feedType, feedProductId: product?.id ?? null, bagSizeKg, quantityBags, unitCostMinor, supplierId: input.supplierId || null } });
      // remember who sells this feed, in what bag and at what price, for next time
      if (product && input.supplierId) {
        await tx.feedProductSupplier.upsert({ where: { feedProductId_supplierId: { feedProductId: product.id, supplierId: String(input.supplierId) } }, create: { farmId, feedProductId: product.id, supplierId: String(input.supplierId), bagSizeKg, unitCostMinor }, update: { bagSizeKg, unitCostMinor } });
      }
      if (product && product.defaultBagKg == null) await tx.feedProduct.update({ where: { id: product.id }, data: { defaultBagKg: bagSizeKg } });
      return created;
    });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid feed entry" }, { status: 400 });
  }
}
