import { spreadsheetText } from "@/lib/spreadsheet-text.mjs";
import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { farmExport } from "@/lib/farm-export";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";

function csv(rows: string[][]) {
  return rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const requestedType = new URL(request.url).searchParams.get("type");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (requestedType === "farm") {
    if (session.user.role !== "OWNER") return NextResponse.json({ error: "Only farm owners can export all records." }, { status: 403, headers });
    return new NextResponse(farmExport(session.user.farmId), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=flockence-farm.json" },
    });
  }
  const type = requestedType === "sales" || requestedType === "inventory" || requestedType === "temperatures" ? requestedType : "batches";
  let content = "";
  if (type === "temperatures") {
    const readings = await prisma.thermometerReading.findMany({
      orderBy: [{ readAt: "desc" }, { id: "asc" }],
      select: { readAt: true, sensor: true, source: true, temperatureC: true, humidityPercent: true },
    });
    content = csv([["observed_at_utc", "sensor", "source", "temperature_c", "humidity_percent"],
      ...readings.map((r) => [r.readAt.toISOString(), spreadsheetText(r.sensor), spreadsheetText(r.source),
        r.temperatureC.toString(), r.humidityPercent?.toString() ?? ""])]);
  } else if (type === "sales") {
    const sales = await prisma.sale.findMany({ where: { farmId: currentFarmId() }, orderBy: { date: "desc" }, include: { items: true } });
    content = csv([["date","customer","total_bbd","paid_bbd","status"], ...sales.map(s => [s.date.toISOString(), spreadsheetText(s.customerName), (s.totalMinor/100).toFixed(2), (s.amountPaidMinor/100).toFixed(2), s.paymentStatus])]);
  } else if (type === "inventory") {
    const items = await prisma.inventoryItem.findMany({ where: { product: { farmId: currentFarmId() } }, include: { product: true, batch: true } });
    content = csv([["product","batch","quantity","weight_kg","status","cost_basis_bbd"], ...items.map(i => [spreadsheetText(i.product.name), spreadsheetText(i.batch?.name), String(i.quantity), i.weightKg?.toString() || "", i.status, (i.costBasisMinor/100).toFixed(2)])]);
  } else {
    const batches = await prisma.batch.findMany({ where: { farmId: currentFarmId() }, orderBy: { startDate: "desc" }, include: { mortalityEvents: true } });
    content = csv([["batch","start_date","initial_chicks","mortality","survivors","status"], ...batches.map(b => { const m=b.mortalityEvents.reduce((x,e)=>x+e.quantity,0); return [spreadsheetText(b.name),b.startDate.toISOString().slice(0,10),String(b.initialChicks),String(m),String(Math.max(0,b.initialChicks-m)),b.status]; })]);
  }
  return new NextResponse(content, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=chicken-op-${type}.csv` } });
}
