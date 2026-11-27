"use client";
import { FormEvent, useEffect, useRef, useState } from "react";

export type EditableFlock = {
  id: string; name: string; productionType?: string | null; species?: string; initialChicks: number;
  startDate: string; hatchDate?: string | null; purchaseDate?: string | null;
  breed?: string | null; strain?: string | null; hatchery?: string | null; sourceLot?: string | null; placementNotes?: string | null; placementHouse?: string | null;
  targetSlaughterAgeDays?: number | null; targetLiveWeightKg?: string | number | null; chickCostMinor?: number | null;
};

const day = (value?: string | null) => (value ? value.slice(0, 10) : "");

/** Correct a flock's set-up: a wrong chick count, placement date, name or target. Records already saved are kept. */
export function FlockEditDialog({ flock, onClose, onSaved }: { flock: EditableFlock | null; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isLayer = flock?.productionType === "LAYER" || String(flock?.species || "").toUpperCase() === "LAYER";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (flock && !dialog.open) {
      setError("");
      setForm({
        name: flock.name, initialChicks: String(flock.initialChicks), startDate: day(flock.startDate), hatchDate: day(flock.hatchDate), purchaseDate: day(flock.purchaseDate),
        breed: flock.breed ?? "", strain: flock.strain ?? "", hatchery: flock.hatchery ?? "", sourceLot: flock.sourceLot ?? "", placementNotes: flock.placementNotes ?? "", placementHouse: flock.placementHouse ?? "",
        targetSlaughterAgeDays: String(flock.targetSlaughterAgeDays ?? 42), targetLiveWeightKg: flock.targetLiveWeightKg != null ? String(Number(flock.targetLiveWeightKg)) : "",
        chickCost: flock.chickCostMinor != null ? (flock.chickCostMinor / 100).toFixed(2) : "",
      });
      dialog.showModal();
    }
    if (!flock && dialog.open) dialog.close();
  }, [flock]);

  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(prev => ({ ...prev, [key]: event.target.value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!flock || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/batches?id=" + encodeURIComponent(flock.id), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, initialChicks: Number(form.initialChicks), startDate: form.startDate, hatchDate: form.hatchDate || null, purchaseDate: form.purchaseDate || null,
          breed: form.breed, strain: form.strain, hatchery: form.hatchery, sourceLot: form.sourceLot, placementNotes: form.placementNotes, placementHouse: form.placementHouse || null,
          chickCostMinor: form.chickCost === "" ? null : Math.round(Number(form.chickCost) * 100),
          ...(isLayer ? {} : { targetSlaughterAgeDays: Number(form.targetSlaughterAgeDays), targetLiveWeightKg: form.targetLiveWeightKg === "" ? null : Number(form.targetLiveWeightKg) }),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the changes.");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the changes."); } finally { setBusy(false); }
  }

  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby="fed-title" onClose={onClose}>
      <form onSubmit={save}>
        <h3 id="fed-title">Edit flock</h3>
        <p>Fix set-up mistakes such as the number of chicks placed or the placement date. Mortality, weights, feed and daily checks already recorded stay as they are. Chicks placed cannot be fewer than the birds already lost or sent for processing.</p>
        <label>Flock name<input value={form.name ?? ""} onChange={set("name")} required maxLength={120} /></label>
        <div className="dialog-grid">
          <label>Chicks placed<input type="number" min="1" step="1" value={form.initialChicks ?? ""} onChange={set("initialChicks")} required /></label>
          <label>Placement date<input type="date" value={form.startDate ?? ""} onChange={set("startDate")} required /></label>
          <label>Hatch date (optional)<input type="date" value={form.hatchDate ?? ""} onChange={set("hatchDate")} /></label>
          <label>Purchase date (optional)<input type="date" value={form.purchaseDate ?? ""} onChange={set("purchaseDate")} /></label>
          {!isLayer && <label>Target age at harvest (days)<input type="number" min="1" max="365" step="1" value={form.targetSlaughterAgeDays ?? ""} onChange={set("targetSlaughterAgeDays")} /></label>}
          {!isLayer && <label>Target live weight (kg)<input type="number" min="0" step="0.01" value={form.targetLiveWeightKg ?? ""} onChange={set("targetLiveWeightKg")} /></label>}
          <label>Price per chick (BBD)<input type="number" min="0" step="0.01" value={form.chickCost ?? ""} onChange={set("chickCost")} /></label>
          <label>Breed<input value={form.breed ?? ""} onChange={set("breed")} /></label>
          <label>Strain<input value={form.strain ?? ""} onChange={set("strain")} /></label>
          <label>Hatchery<input value={form.hatchery ?? ""} onChange={set("hatchery")} /></label>
          <label>Source lot<input value={form.sourceLot ?? ""} onChange={set("sourceLot")} /></label>
        </div>
        <label>Placed in house<input value={form.placementHouse ?? ""} onChange={set("placementHouse")} maxLength={80} placeholder="House or pen name" /></label>
        <label>Placement notes<textarea value={form.placementNotes ?? ""} onChange={set("placementNotes")} /></label>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </dialog>
  );
}
