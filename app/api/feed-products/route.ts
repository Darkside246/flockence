import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { ensureFeedCatalogue, feedLabel } from "@/lib/feed-catalogue";

/** The farm's feed catalogue: products, their usual bag size, preferred supplier and the suppliers that sell them. */
const text = (v: unknown, max = 160) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const kg = (v: unknown) => (v === "" || v == null ? null : Number(v));

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const farmId = currentFarmId();
  const all = new URL(request.url).searchParams.get("all") === "1";
  const rows = await prisma.$transaction(async tx => {
    await ensureFeedCatalogue(tx, farmId);
    return tx.feedProduct.findMany({
      where: { farmId, ...(all ? {} : { active: true }) },
      orderBy: [{ sortOrder: "asc" }, { brand: "asc" }, { name: "asc" }],
      include: { preferredSupplier: { select: { id: true, name: true } }, suppliers: { include: { supplier: { select: { id: true, name: true } } } } },
    });
  });
  return NextResponse.json(rows.map(p => ({ ...p, label: feedLabel(p), defaultBagKg: p.defaultBagKg == null ? null : Number(p.defaultBagKg) })));
}

async function applySuppliers(farmId: string, productId: string, list: unknown) {
  if (!Array.isArray(list)) return;
  const wanted = list.filter(x => x && typeof x.supplierId === "string").map(x => ({ supplierId: x.supplierId as string, bagSizeKg: kg(x.bagSizeKg), unitCostMinor: x.unitCostMinor == null || x.unitCostMinor === "" ? null : Number(x.unitCostMinor) }));
  await prisma.$transaction(async tx => {
    await tx.feedProductSupplier.deleteMany({ where: { farmId, feedProductId: productId, supplierId: { notIn: wanted.map(w => w.supplierId) } } });
    for (const w of wanted) {
      await tx.feedProductSupplier.upsert({ where: { feedProductId_supplierId: { feedProductId: productId, supplierId: w.supplierId } }, create: { farmId, feedProductId: productId, ...w }, update: { bagSizeKg: w.bagSizeKg, unitCostMinor: w.unitCostMinor } });
    }
  });
}

function validate(input: Record<string, unknown>) {
  const bag = kg(input.defaultBagKg);
  if (bag !== null && (!Number.isFinite(bag) || bag <= 0 || bag > 1000)) return "Bag size must be more than 0 kg.";
  return null;
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const input = await request.json().catch(() => ({}));
  const name = text(input.name);
  if (!name) return NextResponse.json({ error: "Name the feed." }, { status: 400 });
  const bad = validate(input);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const farmId = currentFarmId();
  const brand = text(input.brand) ?? "";
  const same = await prisma.feedProduct.findFirst({ where: { farmId, brand: { equals: brand, mode: "insensitive" }, name: { equals: name, mode: "insensitive" } } });
  if (same) return NextResponse.json({ ...same, existing: true });
  const row = await prisma.feedProduct.create({ data: { farmId, brand, name, description: text(input.description, 400), defaultBagKg: kg(input.defaultBagKg), preferredSupplierId: text(input.preferredSupplierId, 64), sortOrder: 500 } });
  await applySuppliers(farmId, row.id, input.suppliers);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const id = new URL(request.url).searchParams.get("id");
  const input = await request.json().catch(() => ({}));
  const farmId = currentFarmId();
  const row = id ? await prisma.feedProduct.findFirst({ where: { id, farmId } }) : null;
  if (!row) return NextResponse.json({ error: "Feed not found." }, { status: 404 });
  const bad = validate(input);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const name = input.name === undefined ? undefined : text(input.name);
  if (name === null) return NextResponse.json({ error: "A feed needs a name." }, { status: 400 });
  try {
    const updated = await prisma.feedProduct.update({ where: { id: row.id }, data: {
      ...(name !== undefined ? { name } : {}),
      ...(input.brand !== undefined ? { brand: text(input.brand) ?? "" } : {}),
      ...(input.description !== undefined ? { description: text(input.description, 400) } : {}),
      ...(input.defaultBagKg !== undefined ? { defaultBagKg: kg(input.defaultBagKg) } : {}),
      ...(input.preferredSupplierId !== undefined ? { preferredSupplierId: text(input.preferredSupplierId, 64) } : {}),
      ...(typeof input.active === "boolean" ? { active: input.active } : {}),
    } });
    await applySuppliers(farmId, row.id, input.suppliers);
    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error && /Unique constraint/.test(error.message) ? "Another feed already has that brand and name." : "Could not save the feed.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
