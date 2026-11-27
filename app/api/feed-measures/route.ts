import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";

/** The farm's own feed measures (scoop, pan, bucket) and how many kg one holds, when the farm has weighed one. */
const KINDS = ["SCOOP", "PAN", "FEEDER", "BUCKET", "OTHER"];
const kgOf = (v: unknown) => (v === "" || v == null ? null : Number(v));

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const rows = await prisma.feedMeasure.findMany({ where: { farmId: currentFarmId() }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return NextResponse.json(rows.map(r => ({ ...r, kgPerUnit: r.kgPerUnit == null ? null : Number(r.kgPerUnit) })));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const input = await request.json().catch(() => ({}));
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  const kgPerUnit = kgOf(input.kgPerUnit);
  if (!name) return NextResponse.json({ error: "Name the measure, for example: Red scoop." }, { status: 400 });
  if (kgPerUnit !== null && (!Number.isFinite(kgPerUnit) || kgPerUnit <= 0 || kgPerUnit > 500)) return NextResponse.json({ error: "How much one holds must be more than 0 kg." }, { status: 400 });
  const kind = KINDS.includes(String(input.kind)) ? String(input.kind) : "OTHER";
  const farmId = currentFarmId();
  const same = await prisma.feedMeasure.findFirst({ where: { farmId, name: { equals: name, mode: "insensitive" } } });
  if (same) return NextResponse.json({ error: "There is already a measure with that name." }, { status: 409 });
  const row = await prisma.feedMeasure.create({ data: { farmId, name, kind, kgPerUnit } });
  return NextResponse.json({ ...row, kgPerUnit: row.kgPerUnit == null ? null : Number(row.kgPerUnit) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const id = new URL(request.url).searchParams.get("id");
  const input = await request.json().catch(() => ({}));
  const row = id ? await prisma.feedMeasure.findFirst({ where: { id, farmId: currentFarmId() } }) : null;
  if (!row) return NextResponse.json({ error: "Measure not found." }, { status: 404 });
  const kgPerUnit = input.kgPerUnit === undefined ? undefined : kgOf(input.kgPerUnit);
  if (kgPerUnit != null && (!Number.isFinite(kgPerUnit) || kgPerUnit <= 0 || kgPerUnit > 500)) return NextResponse.json({ error: "How much one holds must be more than 0 kg." }, { status: 400 });
  const updated = await prisma.feedMeasure.update({ where: { id: row.id }, data: {
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim().slice(0, 60) } : {}),
    ...(KINDS.includes(String(input.kind)) ? { kind: String(input.kind) } : {}),
    ...(kgPerUnit !== undefined ? { kgPerUnit } : {}),
    ...(typeof input.active === "boolean" ? { active: input.active } : {}),
  } });
  return NextResponse.json({ ...updated, kgPerUnit: updated.kgPerUnit == null ? null : Number(updated.kgPerUnit) });
}
