import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, FARM_ID } from "@/lib/operations";

function csv(rows: string[][]) {
  return rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const type = new URL(request.url).searchParams.get("type") || "batches";
  let content = "";
  if (type === "sales") {
    const sales = await prisma.sale.findMany({ where: { farmId: FARM_ID }, orderBy: { date: "desc" }, include: { items: true } });
    content = csv([["date","customer","total_bbd","paid_bbd","status"], ...sales.map(s => [s.date.toISOString(), s.customerName || "", (s.totalMinor/100).toFixed(2), (s.amountPaidMinor/100).toFixed(2), s.paymentStatus])]);
  } else if (type === "inventory") {
    const items = await prisma.inventoryItem.findMany({ where: { product: { farmId: FARM_ID } }, include: { product: true, batch: true } });
    content = csv([["product","batch","quantity","weight_kg","status","cost_basis_bbd"], ...items.map(i => [i.product.name, i.batch?.name || "", String(i.quantity), i.weightKg?.toString() || "", i.status, (i.costBasisMinor/100).toFixed(2)])]);
  } else {
    const batches = await prisma.batch.findMany({ where: { farmId: FARM_ID }, orderBy: { startDate: "desc" }, include: { mortalityEvents: true } });
    content = csv([["batch","start_date","initial_chicks","mortality","survivors","status"], ...batches.map(b => { const m=b.mortalityEvents.reduce((x,e)=>x+e.quantity,0); return [b.name,b.startDate.toISOString().slice(0,10),String(b.initialChicks),String(m),String(Math.max(0,b.initialChicks-m)),b.status]; })]);
  }
  return new NextResponse(content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=chicken-op-${type}.csv` } });
}
