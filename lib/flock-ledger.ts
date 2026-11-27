import type { Prisma } from "@prisma/client";
import { birdBalance, type BirdEvent } from "./farm-engine.mjs";

/**
 * The one place that works out how many birds a flock has, from the recorded events:
 *   birds placed (Batch.initialChicks) + BirdMovement ADDITION − MortalityEvent (died, culled, missing)
 *   − SlaughterEvent.sentQuantity, with real head counts (BirdCount rows typed in by a person) as observations.
 *
 * BirdCount rows whose note starts "Calculated after" are projections: shortcuts other pages read. They are never
 * trusted here and can be thrown away and rebuilt at any time with rebuildBirdProjections().
 */
type Tx = Prisma.TransactionClient;

export const PROJECTION_PREFIX = "Calculated after";
const isObservation = (note: string | null) => !note || (!note.startsWith(PROJECTION_PREFIX) && note !== "Initial count");
const KIND_TO_EVENT: Record<string, "MORTALITY" | "CULL" | "MISSING"> = { DIED: "MORTALITY", CULLED: "CULL", MISSING: "MISSING" };

export type FlockLedger = Awaited<ReturnType<typeof loadFlockLedger>>;

export async function loadFlockLedger(tx: Tx, batchId: string, asOf?: Date) {
  const batch = await tx.batch.findFirst({ where: { id: batchId }, select: { id: true, name: true, initialChicks: true, startDate: true, status: true, placementHouse: true } });
  if (!batch) return null;
  const until = asOf ? { lte: asOf } : undefined;
  const [deaths, sent, moves, counts] = await Promise.all([
    tx.mortalityEvent.findMany({ where: { batchId, ...(until ? { date: until } : {}) }, select: { id: true, quantity: true, kind: true, date: true, createdAt: true, reason: true } }),
    tx.slaughterEvent.findMany({ where: { batchId, ...(until ? { date: until } : {}) }, select: { id: true, sentQuantity: true, date: true, createdAt: true } }),
    tx.birdMovement.findMany({ where: { batchId, voidedAt: null, ...(until ? { date: until } : {}) }, select: { id: true, type: true, quantity: true, date: true, createdAt: true, fromHouse: true, toHouse: true } }),
    tx.birdCount.findMany({ where: { batchId, ...(until ? { date: until } : {}) }, select: { liveCount: true, date: true, createdAt: true, note: true } }),
  ]);
  const events: BirdEvent[] = [
    ...deaths.map(d => ({ type: KIND_TO_EVENT[d.kind] ?? "MORTALITY", quantity: d.quantity, date: d.date, createdAt: d.createdAt })),
    ...sent.map(s => ({ type: "SLAUGHTER", quantity: s.sentQuantity, date: s.date, createdAt: s.createdAt })),
    ...moves.flatMap((m): BirdEvent[] => m.type === "ADDITION"
      ? [{ type: "ADDITION", quantity: m.quantity, date: m.date, createdAt: m.createdAt, house: m.toHouse }]
      : [
          { type: "TRANSFER_OUT", quantity: m.quantity, date: m.date, createdAt: m.createdAt, fromHouse: m.fromHouse },
          { type: "TRANSFER_IN", quantity: m.quantity, date: m.date, createdAt: m.createdAt, toHouse: m.toHouse },
        ]),
  ];
  const headCounts = counts.filter(c => isObservation(c.note)).map(c => ({ count: c.liveCount, date: c.date, createdAt: c.createdAt }));
  const balance = birdBalance({ initialBirds: batch.initialChicks, events, headCounts, asOf, placementHouse: batch.placementHouse });
  const added = moves.filter(m => m.type === "ADDITION").reduce((s, m) => s + m.quantity, 0);
  return { batch, balance, everInFlock: batch.initialChicks + added };
}

/** Live birds on a date, or throws with a reason a person can act on. */
export async function liveBirdsOn(tx: Tx, batchId: string, date: Date) {
  const ledger = await loadFlockLedger(tx, batchId, date);
  if (!ledger) throw new Error("Flock not found.");
  if (!ledger.balance.ok) throw new Error(ledger.balance.error ?? "The live bird count could not be worked out from the flock's records.");
  return ledger.balance.live as number;
}

/**
 * Throw away every projection row and write one per addition date, so pages that read "the latest bird count" agree with
 * the ledger after a correction. Head counts and the initial count are never touched.
 */
export async function rebuildBirdProjections(tx: Tx, batchId: string) {
  await tx.birdCount.deleteMany({ where: { batchId, note: { startsWith: PROJECTION_PREFIX } } });
  const additions = await tx.birdMovement.findMany({ where: { batchId, type: "ADDITION", voidedAt: null }, select: { date: true }, orderBy: { date: "asc" } });
  const days = [...new Set(additions.map(a => a.date.toISOString().slice(0, 10)))];
  for (const d of days) {
    const date = new Date(d + "T00:00:00.000Z");
    const live = await liveBirdsOn(tx, batchId, date);
    await tx.birdCount.create({ data: { batchId, date, liveCount: live, note: PROJECTION_PREFIX + " bird addition" } });
  }
}

/** Close a flock that has no birds left; used after any loss or slaughter. Returns the live count. */
export async function closeIfEmpty(tx: Tx, batchId: string, statusWhenEmpty: "CLOSED" | "SLAUGHTERED" = "CLOSED") {
  const ledger = await loadFlockLedger(tx, batchId);
  if (!ledger || !ledger.balance.ok) return null;
  if (ledger.balance.live === 0 && ledger.batch.status === "ACTIVE") await tx.batch.update({ where: { id: batchId }, data: { status: statusWhenEmpty } });
  return ledger.balance.live as number;
}
