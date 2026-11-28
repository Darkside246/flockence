"use client";

import { FormEvent, useEffect, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type Batch = { id: string; name: string };
type Location = { id: string; name: string; type?: string; active?: boolean };
type Plan = {
  ok: boolean; error?: string; liveBirds: number | null; birdsAvailable: boolean; ageDays: number | null;
  liveWeight: { kg: number; status: string; basis: string } | null;
  expected: { carcassKg: number; rangeKg: [number, number]; basis: string } | null;
  storage: { ok: boolean; fits?: boolean; requiredKg?: number; freeKg?: number; shortfallKg?: number; warning?: string | null; note?: string; location?: string } | null;
  missing: string[];
};
const today = () => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);

/**
 * Record birds sent to slaughter. While the farmer types, a pre-slaughter check shows the birds available, the expected
 * meat and whether it fits the chosen store. The check advises; a slaughter that has happened can always be recorded.
 */
export function SlaughterForm({ batches, onSaved }: { batches: Batch[]; onSaved?: (message: string) => void }) {
  const [batchId, setBatchId] = useState(""), [date, setDate] = useState(today());
  const [sent, setSent] = useState(""), [slaughtered, setSlaughtered] = useState(""), [condemned, setCondemned] = useState("0");
  const [liveKg, setLiveKg] = useState(""), [dressedKg, setDressedKg] = useState(""), [definition, setDefinition] = useState("");
  const [costPerBird, setCost] = useState("2.00"), [chilling, setChilling] = useState(""), [notes, setNotes] = useState("");
  const [locations, setLocations] = useState<Location[]>([]), [locationId, setLocationId] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null), [override, setOverride] = useState(""), [stockNow, setStockNow] = useState(true);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");

  useEffect(() => { fetch("/api/storage-locations").then(r => r.ok ? r.json() : []).then(rows => Array.isArray(rows) && setLocations(rows.filter((l: Location) => l.active !== false))).catch(() => {}); }, []);
  useEffect(() => {
    setPlan(null);
    const birds = Number(sent);
    if (!batchId || !Number.isSafeInteger(birds) || birds < 1) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/slaughter/intelligence?" + new URLSearchParams({ batchId, birds: String(birds), date, ...(locationId ? { storageLocationId: locationId } : {}), definition: definition || "CARCASS" }), { signal: controller.signal })
        .then(r => r.json()).then(d => { if (!controller.signal.aborted) setPlan(d); }).catch(() => {});
    }, 250);
    return () => { clearTimeout(t); controller.abort(); };
  }, [batchId, sent, date, locationId, definition]);

  const noRoom = plan?.storage?.ok && plan.storage.fits === false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (dressedKg && !definition) { setMsg("Say whether the dressed weight includes the giblets."); return; }
    if (noRoom && !override.trim()) { setMsg("The store looks too full. Say where the extra meat will go before saving."); return; }
    setBusy(true); setMsg("");
    const birds = Number(slaughtered || sent);
    try {
      const r = await fetch("/api/slaughter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        batchId, date, sentQuantity: Number(sent), slaughtered: Number(slaughtered || sent), condemned: Number(condemned || 0),
        slaughterCostMinor: Math.round(Number(costPerBird || 0) * birds * 100),
        liveWeightKg: liveKg ? Number(liveKg) : null, dressedWeightKg: dressedKg ? Number(dressedKg) : null, dressedDefinition: definition || null,
        chillingCompletedAt: chilling || null, notes: notes || null, stockNow: Boolean(stockNow && locationId && dressedKg && definition), storageLocationId: locationId || null, storageOverrideReason: noRoom ? override.trim() : null, submissionId: crypto.randomUUID(),
      }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "That did not save.");
      const m = `Saved. ${sent} birds sent to slaughter${d.liveBirdsNow != null ? `; ${d.liveBirdsNow} live birds left in the flock` : ""}. ${d.stocked ? `${d.stocked.quantity} whole birds (${d.stocked.weightKg} kg) are now in ${d.stocked.location}. Add giblets, feet or cuts under Processing pack.` : "Record the meat under Processing pack to put it in stock."}`;
      setMsg(m); onSaved?.(m);
      setSent(""); setSlaughtered(""); setCondemned("0"); setLiveKg(""); setDressedKg(""); setDefinition(""); setNotes(""); setOverride(""); setChilling("");
    } catch (err) { setMsg(err instanceof Error ? err.message : "That did not save."); } finally { setBusy(false); }
  }

  return <form className="card form" onSubmit={submit}>
    <h3>Slaughter event</h3>
    <label>Flock<select value={batchId} onChange={e => setBatchId(e.target.value)} required><option value="">Select flock</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <label>Date<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} required /></label>
    <label>Birds sent<input type="number" min="1" step="1" value={sent} onChange={e => setSent(e.target.value)} required /></label>
    <label>Birds slaughtered<input type="number" min="0" step="1" value={slaughtered} placeholder={sent || ""} onChange={e => setSlaughtered(e.target.value)} /></label>
    <label>Condemned<input type="number" min="0" step="1" value={condemned} onChange={e => setCondemned(e.target.value)} /></label>
    <label>Store the meat in<select value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">Choose to check space</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>

    {plan?.ok && <div className="preflight" role="status" aria-live="polite">
      <strong>Before you slaughter</strong>
      <ul>
        <li>{plan.liveBirds != null ? (plan.birdsAvailable ? `${plan.liveBirds} live birds in the flock` : `Only ${plan.liveBirds} live birds in the flock`) : "Live birds could not be worked out"}{plan.ageDays != null ? ` · ${plan.ageDays} days old` : ""}</li>
        {plan.expected && <li>Expected meat: about {plan.expected.carcassKg} kg (between {plan.expected.rangeKg[0]} and {plan.expected.rangeKg[1]} kg). <span className="muted">Estimate. {plan.expected.basis}</span></li>}
        {plan.storage && (plan.storage.ok
          ? <li className={plan.storage.fits ? "" : "preflight-warn"}>{plan.storage.location}: {plan.storage.freeKg} kg free, up to {plan.storage.requiredKg} kg needed. {plan.storage.fits ? "It fits." : `About ${plan.storage.shortfallKg} kg short.`}{plan.storage.warning ? ` ${plan.storage.warning}` : ""}</li>
          : <li className="preflight-warn">{plan.storage.note}</li>)}
        {plan.missing.map(m => <li key={m} className="muted">{m}</li>)}
      </ul>
    </div>}
    {noRoom && <label>Where will the extra meat go?<input value={override} onChange={e => setOverride(e.target.value)} placeholder="For example: second chest freezer, or sold fresh the same day" maxLength={300} required /></label>}

    <label>Total live weight kg (if weighed)<input type="number" min="0" step="0.001" value={liveKg} onChange={e => setLiveKg(e.target.value)} /></label>
    <label>Total dressed weight kg<input type="number" min="0" step="0.001" value={dressedKg} onChange={e => setDressedKg(e.target.value)} /></label>
    {dressedKg && <label>Does the dressed weight include the giblets?<select value={definition} onChange={e => setDefinition(e.target.value)} required><option value="">Choose</option><option value="CARCASS">No, carcass only</option><option value="CARCASS_WITH_GIBLETS">Yes, giblets packed inside</option></select></label>}
    {dressedKg && locationId && <label className="check-line"><input type="checkbox" checked={stockNow} onChange={e => setStockNow(e.target.checked)} /> Put the whole dressed birds in {locations.find(l => l.id === locationId)?.name ?? "the store"} now</label>}
    <label>Slaughter cost / bird BBD<input type="number" min="0" step="0.01" value={costPerBird} onChange={e => setCost(e.target.value)} /></label>
    <label>Chilling completed<input type="datetime-local" value={chilling} onChange={e => setChilling(e.target.value)} /></label>
    <label>Notes<input value={notes} onChange={e => setNotes(e.target.value)} maxLength={400} /></label>
    {msg && <p className="notice" role="status">{msg}</p>}
    <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Record slaughter"}</button>
  </form>;
}
