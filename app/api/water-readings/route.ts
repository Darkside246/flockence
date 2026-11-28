import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { meterUsage, tankUsage } from "@/lib/farm-engine.mjs";
import { penRecordDenied } from "@/lib/pen-access";

/**
 * Water meter and tank readings. GET returns each meter or tank's readings with the water used between them, worked out
 * from the readings (a meter that goes backwards, or a tank that rises without a refill, is flagged, not turned into a number).
 */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batchId = new URL(request.url).searchParams.get("batchId");
  const rows = await prisma.waterReading.findMany({ where: { farmId: currentFarmId(), ...(batchId ? { batchId } : {}) }, orderBy: { readAt: "asc" }, take: 500 });
  const sources = [...new Set(rows.map(r => `${r.kind}::${r.source}`))].map(k => {
    const rs = rows.filter(r => `${r.kind}::${r.source}` === k);
    const usage = rs[0].kind === "TANK"
      ? tankUsage(rs.map(r => ({ at: r.readAt, levelL: Number(r.readingL), addedL: r.addedL == null ? 0 : Number(r.addedL), otherUseL: r.otherUseL == null ? 0 : Number(r.otherUseL) })))
      : meterUsage(rs.map(r => ({ at: r.readAt, reading: Number(r.readingL) })));
    return { source: rs[0].source, kind: rs[0].kind, batchId: rs.at(-1)!.batchId, last: { readingL: Number(rs.at(-1)!.readingL), readAt: rs.at(-1)!.readAt }, usage: usage.slice(-14) };
  });
  return NextResponse.json({ sources });
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send the reading." }, { status: 400 }); }
  const source = typeof input.source === "string" ? input.source.trim().slice(0, 80) : "";
  const kind = input.kind === "TANK" ? "TANK" : "METER";
  const n = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const readingL = n(input.readingL), addedL = n(input.addedL), otherUseL = n(input.otherUseL);
  const readAt = input.readAt ? new Date(String(input.readAt)) : new Date();
  if (!source) return NextResponse.json({ error: "Name the meter or tank." }, { status: 400 });
  if (readingL == null || !Number.isFinite(readingL) || readingL < 0) return NextResponse.json({ error: "Enter the reading in litres." }, { status: 400 });
  if ([addedL, otherUseL].some(v => v != null && (!Number.isFinite(v) || v < 0))) return NextResponse.json({ error: "Refill and other use must be zero or more litres." }, { status: 400 });
  if (!Number.isFinite(readAt.getTime()) || readAt.getTime() > Date.now() + 5 * 60000) return NextResponse.json({ error: "The reading time must be now or earlier." }, { status: 400 });
  const batchId = typeof input.batchId === "string" && input.batchId ? input.batchId : null;
  const penDenied = await penRecordDenied(session.user, { batchId }, true);
  if (penDenied) return penDenied;
  if (batchId && !(await prisma.batch.findFirst({ where: { id: batchId, farmId: currentFarmId() }, select: { id: true } }))) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  const id = typeof input.submissionId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(input.submissionId) ? "water:" + input.submissionId : undefined;
  if (id) {
    const again = await prisma.waterReading.findUnique({ where: { id } });
    if (again) return NextResponse.json({ reading: again, repeated: true });
  }
  const prev = await prisma.waterReading.findFirst({ where: { farmId: currentFarmId(), source, kind, readAt: { lt: readAt } }, orderBy: { readAt: "desc" } });
  const reading = await prisma.waterReading.create({ data: { ...(id ? { id } : {}), farmId: currentFarmId(), batchId, source, kind, readingL, addedL: kind === "TANK" ? addedL : null, otherUseL: kind === "TANK" ? otherUseL : null, readAt, notes: typeof input.notes === "string" ? input.notes.slice(0, 300) : null, createdByUserId: session.user!.id } });
  const [interval] = !prev ? [null] : kind === "METER"
    ? meterUsage([{ at: prev.readAt, reading: Number(prev.readingL) }, { at: reading.readAt, reading: readingL }])
    : tankUsage([{ at: prev.readAt, levelL: Number(prev.readingL) }, { at: reading.readAt, levelL: readingL, addedL: addedL ?? 0, otherUseL: otherUseL ?? 0 }]);
  return NextResponse.json({ reading, usedSinceLast: interval ?? null, note: prev ? null : "First reading for this meter or tank. Water used is worked out from the next one." }, { status: 201 });
}
