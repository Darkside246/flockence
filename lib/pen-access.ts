import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import { visionPens } from "@/lib/vision-pens";

/**
 * Pen-level access for Farm Hands (owner, 28 Nov 2026): a Farm Hand assigned to some pens still sees the whole farm, but
 * records deaths, daily checks, eggs, feed, weights, health notes and Farm Vision photos only for flocks placed in those
 * pens (Batch.placementHouse names the pen). A Farm Hand with no assignment keeps access to every pen, as before.
 * Owners and Supervisors are never limited, and are the ones who assign pens (Team page).
 */
const keyFor = (userId: string) => "PEN_ASSIGN_V1::" + userId;

export async function penAssignment(userId: string): Promise<string[] | null> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: keyFor(userId) } }, select: { value: true } });
  try {
    const pens = row ? JSON.parse(row.value)?.pens : null;
    return Array.isArray(pens) && pens.length ? pens.filter((p: unknown): p is string => typeof p === "string") : null;
  } catch { return null; }
}

export async function savePenAssignment(userId: string, pens: string[]) {
  const farmId = currentFarmId(), key = keyFor(userId);
  const known = new Set((await visionPens()).map((p) => p.id));
  const clean = [...new Set(pens)].filter((id) => known.has(id));
  if (!clean.length) { await prisma.setting.deleteMany({ where: { farmId, key } }); return [] as string[]; }
  const value = JSON.stringify({ pens: clean });
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
  return clean;
}

export async function allPenAssignments() {
  const rows = await prisma.setting.findMany({ where: { farmId: currentFarmId(), key: { startsWith: "PEN_ASSIGN_V1::" } }, select: { key: true, value: true } });
  return Object.fromEntries(rows.flatMap((r) => {
    try { const pens = JSON.parse(r.value)?.pens; return Array.isArray(pens) ? [[r.key.slice("PEN_ASSIGN_V1::".length), pens as string[]]] : []; } catch { return []; }
  }));
}

/**
 * Null when this person may record for the flock or pen; otherwise the 403 to send. `allowFarmWide` lets a record that
 * names no flock or pen through (a shared water meter); otherwise a limited Farm Hand must name one of their flocks.
 */
export async function penRecordDenied(user: { id: string; role: string }, target: { batchId?: string | null; penId?: string | null }, allowFarmWide = false) {
  if (user.role !== "WORKER") return null;
  const assigned = await penAssignment(user.id);
  if (!assigned) return null;
  const pens = await visionPens();
  const names = pens.filter((p) => assigned.includes(p.id)).map((p) => p.name);
  const refuse = () => NextResponse.json({ error: `You record for flocks in your pens only (${names.join(", ") || "none set"}). Ask a supervisor if this flock needs you.` }, { status: 403 });
  if (target.penId) return assigned.includes(target.penId) ? null : refuse();
  if (target.batchId) {
    const batch = await prisma.batch.findFirst({ where: { id: target.batchId }, select: { placementHouse: true } });
    const pen = batch?.placementHouse ? pens.find((p) => p.name === batch.placementHouse) : null;
    return pen && assigned.includes(pen.id) ? null : refuse();
  }
  return allowFarmWide ? null : refuse();
}
