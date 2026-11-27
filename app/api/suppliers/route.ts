import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { SUPPLIER_CATEGORIES } from "@/lib/suppliers";

/**
 * The farm's suppliers and dealers. Categories are a starting list; a farm can type its own. A supplier can be added
 * in the middle of a purchase with just a name; adding a name that already exists returns the existing supplier
 * instead of a duplicate.
 */
const text = (v: unknown, max = 160) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const category = (v: unknown) => {
  const c = text(v, 40);
  if (!c) return "OTHER";
  const upper = c.toUpperCase();
  return (SUPPLIER_CATEGORIES as readonly string[]).includes(upper) ? upper : c;   // the farm's own category keeps its own wording
};
const fields = (i: Record<string, unknown>) => ({
  phone: text(i.phone, 40), whatsapp: text(i.whatsapp, 40), email: text(i.email, 120), businessName: text(i.businessName),
  contactPerson: text(i.contactPerson, 120), location: text(i.location), productsSupplied: text(i.productsSupplied, 400), notes: text(i.notes, 1000),
});

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const q = new URL(request.url).searchParams;
  const cat = q.get("category"), all = q.get("all") === "1";
  const rows = await prisma.supplier.findMany({
    where: { farmId: currentFarmId(), ...(all ? {} : { active: true }), ...(cat ? { category: cat } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER", "WORKER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const i = await request.json();
    const name = text(i.name, 120);
    if (!name) return NextResponse.json({ error: "Supplier name is required." }, { status: 400 });
    const farmId = currentFarmId();
    const same = await prisma.supplier.findFirst({ where: { farmId, name: { equals: name, mode: "insensitive" } } });
    if (same) return NextResponse.json({ ...same, existing: true });
    const row = await prisma.supplier.create({ data: { farmId, name, category: category(i.category), ...fields(i) } });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add the supplier." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const id = new URL(request.url).searchParams.get("id");
  const i = await request.json().catch(() => ({}));
  const farmId = currentFarmId();
  const row = id ? await prisma.supplier.findFirst({ where: { id, farmId } }) : null;
  if (!row) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  const name = i.name === undefined ? undefined : text(i.name, 120);
  if (name === null) return NextResponse.json({ error: "A supplier needs a name." }, { status: 400 });
  if (name && name.toLowerCase() !== row.name.toLowerCase() && await prisma.supplier.findFirst({ where: { farmId, name: { equals: name, mode: "insensitive" }, NOT: { id: row.id } } })) {
    return NextResponse.json({ error: "Another supplier already has that name." }, { status: 409 });
  }
  const given = fields(i);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(given)) if (i[k] !== undefined) data[k] = v;
  const updated = await prisma.supplier.update({ where: { id: row.id }, data: {
    ...data, ...(name ? { name } : {}), ...(i.category !== undefined ? { category: category(i.category) } : {}), ...(typeof i.active === "boolean" ? { active: i.active } : {}),
  } });
  return NextResponse.json(updated);
}
