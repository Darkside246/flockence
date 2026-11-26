import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { withProtectedFarmData } from "@/lib/farm-database";
import { ensureFarm, currentFarmId } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const rows = await withProtectedFarmData("customer", (db) =>
      db.customer.findMany({ where: { farmId: currentFarmId() }, orderBy: { name: "asc" } }));
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: "Customer records are temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    if (!input?.name) return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
    const customer = await withProtectedFarmData("customer", (db) => db.customer.create({
      data: { farmId: currentFarmId(), name: input.name, phone: input.phone || null, notes: input.notes || null },
    }));
    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid customer information." }, { status: 400 });
    return NextResponse.json({ error: "Could not create customer." }, { status: 503 });
  }
}
