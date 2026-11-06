import type { Prisma } from "@prisma/client";
import { calibrateYield, estimateLiveWeight, recoveredWeight, REFERENCE_YIELD, storagePreflight, type YieldDefinition } from "./farm-engine.mjs";
import { loadFlockLedger } from "./flock-ledger";

type Tx = Prisma.TransactionClient;
const n = (v: unknown) => (v == null ? null : Number(v));
const KG_UNITS = ["kg", "kgs", "kilogram", "kilograms"];

/** Weight already in a store: items with a weight, plus kg-unit items; items with neither are counted as unweighed. */
export async function storedInLocation(tx: Tx, farmId: string, storageLocationId: string) {
  const items = await tx.inventoryItem.findMany({
    where: { storageLocationId, product: { farmId }, status: { in: ["AVAILABLE", "RESERVED"] } },
    select: { weightKg: true, quantity: true, product: { select: { unit: true } } },
  });
  let grams = 0, unweighed = 0;
  for (const item of items) {
    const kgUnit = KG_UNITS.includes(String(item.product?.unit ?? "").trim().toLowerCase());
    const explicit = n(item.weightKg);
    const kg = explicit == null || (explicit === 0 && kgUnit) ? (kgUnit ? n(item.quantity) : null) : explicit;
    if (kg == null || !Number.isFinite(kg) || kg < 0) { unweighed++; continue; }
    grams += Math.round(kg * 1000);
  }
  return { storedKg: grams / 1000, unweighedItems: unweighed, items: items.length };
}

/** The farm's own carcass-to-live ratio, from slaughters where both totals were weighed and the carcass definition said. */
export async function farmYieldCalibration(tx: Tx, farmId: string, definition: YieldDefinition) {
  const rows = await tx.slaughterEvent.findMany({
    where: { batch: { farmId }, liveWeightKg: { not: null }, dressedWeightKg: { not: null }, dressedDefinition: definition },
    select: { liveWeightKg: true, dressedWeightKg: true },
    orderBy: { date: "desc" }, take: 60,
  });
  const unlabelled = await tx.slaughterEvent.count({ where: { batch: { farmId }, liveWeightKg: { not: null }, dressedWeightKg: { not: null }, dressedDefinition: null } });
  const calibration = calibrateYield(rows.map(r => ({ definition, liveKg: Number(r.liveWeightKg), recoveredKg: Number(r.dressedWeightKg) })), definition);
  return { calibration, unlabelledSlaughters: unlabelled };
}

/** Best available average live weight for a flock right now, with where it came from. Never invents one. */
async function currentLiveWeight(tx: Tx, batchId: string) {
  const weighed = await tx.weightRecord.findFirst({ where: { batchId, liveOrDressed: "LIVE" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { avgWeightKg: true, date: true, quantity: true } });
  if (weighed) return { kg: Number(weighed.avgWeightKg), status: "MEASURED" as const, basis: `Average of ${weighed.quantity} bird(s) weighed on ${weighed.date.toISOString().slice(0, 10)}.`, date: weighed.date };
  const batch = await tx.batch.findFirst({ where: { id: batchId }, select: { targetLiveWeightKg: true } });
  if (batch?.targetLiveWeightKg != null) return { kg: Number(batch.targetLiveWeightKg), status: "FORECAST" as const, basis: "No birds weighed yet; using the flock's target live weight.", date: null };
  return null;
}

/**
 * Before a planned slaughter: birds available, age, expected carcass weight and whether it fits the chosen store.
 * Advisory: it never blocks recording a slaughter that has already happened.
 */
export async function planSlaughter(tx: Tx, farmId: string, p: { batchId: string; birds: number; date: Date; storageLocationId?: string | null; definition?: YieldDefinition }) {
  const definition = p.definition ?? "CARCASS";
  const ledger = await loadFlockLedger(tx, p.batchId, p.date);
  if (!ledger) return { ok: false as const, error: "Flock not found." };
  const batch = await tx.batch.findFirst({ where: { id: p.batchId }, select: { startDate: true, hatchDate: true, name: true } });
  const born = batch?.hatchDate ?? batch?.startDate ?? null;
  const ageDays = born ? Math.floor((p.date.getTime() - new Date(born.toISOString().slice(0, 10) + "T00:00:00Z").getTime()) / 86400000) : null;
  const live = ledger.balance.ok ? ledger.balance.live! : null;
  const weight = await currentLiveWeight(tx, p.batchId);
  const { calibration, unlabelledSlaughters } = await farmYieldCalibration(tx, farmId, definition);
  const ratio = calibration.ok ? { value: calibration.ratio!, low: calibration.ratio! - 2 * calibration.sd!, high: calibration.ratio! + 2 * calibration.sd!, from: `your farm's last ${calibration.n} weighed slaughters` }
    : definition === "CARCASS" ? { value: (REFERENCE_YIELD.CARCASS.low + REFERENCE_YIELD.CARCASS.high) / 2, low: REFERENCE_YIELD.CARCASS.low, high: REFERENCE_YIELD.CARCASS.high, from: `a typical range (${REFERENCE_YIELD.CARCASS.source}); not yet calibrated to your farm` } : null;
  const expected = weight && ratio ? {
    status: "ESTIMATED" as const,
    carcassKg: Math.round(p.birds * weight.kg * ratio.value * 1000) / 1000,
    rangeKg: [Math.round(p.birds * weight.kg * ratio.low * 1000) / 1000, Math.round(p.birds * weight.kg * ratio.high * 1000) / 1000] as [number, number],
    basis: `${p.birds} birds × ${weight.kg} kg (${weight.status === "MEASURED" ? "weighed" : "target"}) × ${(ratio.value * 100).toFixed(1)}% carcass yield from ${ratio.from}.`,
  } : null;

  let storage = null as null | ReturnType<typeof storagePreflight> & { location?: string };
  if (p.storageLocationId) {
    const loc = await tx.storageLocation.findFirst({ where: { id: p.storageLocationId, farmId }, select: { id: true, name: true, capacityKg: true } });
    if (loc) {
      const stored = await storedInLocation(tx, farmId, loc.id);
      // the high end of the expected range is what has to fit
      storage = { ...storagePreflight({ expectedKg: expected?.rangeKg[1] ?? 0, capacityKg: n(loc.capacityKg), storedKg: stored.storedKg, unweighedItems: stored.unweighedItems }), location: loc.name };
    }
  }
  const missing: string[] = [];
  if (!weight) missing.push("Weigh a sample of birds (or set a target live weight) so the expected meat can be worked out.");
  if (!calibration.ok) missing.push(unlabelledSlaughters > 0 ? `${unlabelledSlaughters} past slaughter(s) have live and dressed weights but do not say whether the giblets were included, so they cannot be used to learn your yield.` : "Record total live weight and dressed weight on a few slaughters so your farm's own yield can be learned.");
  return {
    ok: true as const,
    flock: batch?.name, liveBirds: live, birdsAvailable: live != null && p.birds <= live, ageDays,
    liveWeight: weight, calibration: calibration.ok ? { ratio: calibration.ratio, sd: calibration.sd, n: calibration.n } : null,
    expected, storage, missing,
  };
}

/** After processing: average live weight worked back from what was recovered, unless the birds were weighed alive. */
export async function liveWeightFromOutput(tx: Tx, farmId: string, slaughterEventId: string) {
  const ev = await tx.slaughterEvent.findFirst({ where: { id: slaughterEventId, batch: { farmId } }, include: { processingOutputs: true } });
  if (!ev) return { ok: false as const, error: "Slaughter not found." };
  if (ev.liveWeightKg != null && ev.slaughtered > 0) {
    return { ok: true as const, status: "MEASURED", averageLiveKg: Math.round((Number(ev.liveWeightKg) / ev.sentQuantity) * 1000) / 1000, basis: "Total live weight weighed at slaughter ÷ birds sent." };
  }
  if (ev.dressedWeightKg == null || ev.slaughtered === 0) return { ok: false as const, status: "MISSING", note: "Needs the total dressed weight (or a live weight) for this slaughter." };
  const definition = (ev.dressedDefinition as YieldDefinition | null) ?? null;
  if (!definition) return { ok: false as const, status: "UNVERIFIED", note: "Say whether the dressed weight includes the giblets, so the right yield can be used." };
  const parts = (cat: string) => ev.processingOutputs.filter(o => o.category.toUpperCase() === cat && o.weightKg != null).reduce((s, o) => s + Number(o.weightKg), 0) || null;
  const recovered = recoveredWeight({ carcassKg: Number(ev.dressedWeightKg), gibletsInsideCarcass: definition === "CARCASS_WITH_GIBLETS" });
  const { calibration } = await farmYieldCalibration(tx, farmId, definition);
  const estimate = estimateLiveWeight({ recoveredKg: recovered.totalKg!, birds: ev.slaughtered, definition, calibration, reference: definition === "CARCASS" ? REFERENCE_YIELD.CARCASS : null });
  return { ...estimate, separatelyWeighedParts: { giblets: parts("GIBLETS"), feet: parts("FEET"), necks: parts("NECKS") } };
}
