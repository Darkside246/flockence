"use client";

import { useEffect, useMemo, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type Batch = { id: string; name: string; initialChicks: number; status: string };
type SlaughterEvent = { id: string; batchId: string; date: string; slaughtered: number; sentQuantity: number };
type StorageLocation = { id: string; name: string; type: string; capacityKg: number | null };
type Row = { productName: string; category: "CARCASS" | "GIBLET" | "FEET" | "PART" | "BYPRODUCT" | "WASTE"; quantity: string; unit: string; weightKg: string; price: string };
type ExistingOutput = { slaughterEventId: string | null; productName: string; quantity: number; unit: string };
const starterRows: Row[] = [
  { productName: "Whole chicken", category: "CARCASS", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Liver", category: "GIBLET", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Gizzard", category: "GIBLET", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Heart", category: "GIBLET", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Feet", category: "FEET", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Neck", category: "PART", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Wings", category: "PART", quantity: "", unit: "each", weightKg: "", price: "" },
  { productName: "Waste", category: "WASTE", quantity: "", unit: "kg", weightKg: "", price: "" },
];
export function ProcessingPack({ batches, slaughterEvents }: { batches: Batch[]; slaughterEvents: SlaughterEvent[] }) {
  const [batchId, setBatchId] = useState("");
  const [rows, setRows] = useState<Row[]>(starterRows);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [storageLocationId, setStorageLocationId] = useState("");
  const [storageState, setStorageState] = useState("CHILLED");
  const [packedAt, setPackedAt] = useState("");
  const [useByDate, setUseByDate] = useState("");
  const [slaughterEventId, setSlaughterEventId] = useState("");
  const [existingOutputs, setExistingOutputs] = useState<ExistingOutput[]>([]);
  const [withdrawalBlocked, setWithdrawalBlocked] = useState(false);
  const [status, setStatus] = useState("");
  const batchEvents = useMemo(
    () => slaughterEvents
      .filter(event => event.batchId === batchId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [slaughterEvents, batchId]
  );
  const selectedEvent = batchEvents.find(event => event.id === slaughterEventId) ?? batchEvents[0] ?? null;
  useEffect(() => { fetch("/api/storage-locations").then(r => r.json()).then(setLocations).catch(() => setLocations([])); }, []);
  useEffect(() => {
    setSlaughterEventId(current =>
      batchEvents.some(event => event.id === current) ? current : batchEvents[0]?.id ?? ""
    );
  }, [batchEvents]);

  useEffect(() => {
    if (!batchId || !selectedEvent) {
      setExistingOutputs([]);
      return;
    }
    let active = true;
    setExistingOutputs([]);
    fetch("/api/processing?batchId=" + encodeURIComponent(batchId))
      .then(async response => {
        if (!response.ok) throw new Error("Could not load existing processing outputs.");
        return response.json();
      })
      .then(data => {
        if (active && Array.isArray(data)) {
          setExistingOutputs(data.filter((row: ExistingOutput) => row.slaughterEventId === selectedEvent.id));
        }
      })
      .catch(() => {
        if (active) setStatus("Could not verify existing output lines. Refresh before adding more products.");
      });
    return () => { active = false; };
  }, [batchId, selectedEvent?.id]);

  const existingProductNames = useMemo(
    () => new Set(existingOutputs.map(row => row.productName.trim().toLocaleLowerCase())),
    [existingOutputs]
  );

  useEffect(() => {
    setRows(current => current.map(row => {
      if (existingProductNames.has(row.productName.trim().toLocaleLowerCase())) {
        return { ...row, quantity: "" };
      }
      if (row.quantity) return row;
      return {
        ...row,
        quantity: !existingProductNames.has(row.productName.toLocaleLowerCase()) && row.productName === "Whole chicken"
          ? String(selectedEvent?.slaughtered ?? "")
          : !existingProductNames.has(row.productName.toLocaleLowerCase()) && row.productName === "Feet"
            ? String((selectedEvent?.slaughtered ?? 0) * 2)
            : ""
      };
    }));
  }, [selectedEvent?.id, existingProductNames]);
  useEffect(() => {
    if (!batchId) { setWithdrawalBlocked(false); return; }
    const effectiveDate = selectedEvent?.date
      ? selectedEvent.date.slice(0, 10)
      : calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
    const query = new URLSearchParams({ batchId, date: effectiveDate });
    fetch("/api/withdrawal-status?" + query.toString())
      .then(r => r.json())
      .then(data => setWithdrawalBlocked(Boolean(data.blocked)))
      .catch(() => setWithdrawalBlocked(true));
  }, [batchId, selectedEvent?.date]);
  function addRow() { setRows(current => [...current, { productName: "Other product", category: "PART", quantity: "", unit: "each", weightKg: "", price: "" }]); }
  function removeRow(index: number) { setRows(current => current.filter((_, i) => i !== index)); }
  function updateRow(index: number, patch: Partial<Row>) { setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setStatus("");
    const outputs = rows.filter(row =>
      Number(row.quantity) > 0 &&
      !existingProductNames.has(row.productName.trim().toLocaleLowerCase())
    ).map(row => ({
      productName: row.productName, category: row.category, quantity: Number(row.quantity), unit: row.unit,
      weightKg: row.weightKg ? Number(row.weightKg) : null, unitPriceMinor: row.price ? Math.round(Number(row.price) * 100) : null, costBasisMinor: 0,
      storageLocationId: storageLocationId || null, packedAt: packedAt || null, useByDate: useByDate || null, storageState,
    }));
    if (!batchId || !selectedEvent || !outputs.length) { setStatus("Select a batch, a slaughter event and at least one processing output."); return; }
    if (withdrawalBlocked) { setStatus("Processing is blocked while this flock has an uncleared withdrawal hold."); return; }
    try {
      const response = await fetch("/api/processing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, slaughterEventId: selectedEvent.id, outputs }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record processing.");
      setStatus("Processing outputs saved. Existing lines are protected from duplicate inventory.");
      setExistingOutputs(current => [
        ...current,
        ...outputs.map(row => ({
          slaughterEventId: selectedEvent.id,
          productName: row.productName,
          quantity: row.quantity,
          unit: row.unit,
        })),
      ]);
      setRows(starterRows.map(row => ({ ...row, quantity: "" })));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not record processing."); }
  }
  return <div className="card form">
    <div className="section-head"><div><h3>Processing pack</h3><p>Record the flock once, then capture the carcass, giblets, feet and other products together.</p></div><span className="badge">ONE ENTRY</span></div>
    <form className="form" onSubmit={submit}>
      <div className="grid2">
        <label>Batch<select value={batchId} onChange={e => setBatchId(e.target.value)} required><option value="">Select batch</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
        <label>Slaughter event<select value={selectedEvent?.id ?? ""} onChange={e => setSlaughterEventId(e.target.value)} required><option value="">Select a slaughter event</option>{batchEvents.map(event => <option key={event.id} value={event.id}>{new Date(event.date).toLocaleDateString()} · {event.slaughtered} slaughtered / {event.sentQuantity} sent</option>)}</select></label>
        <label>Storage location<select value={storageLocationId} onChange={e => setStorageLocationId(e.target.value)}><option value="">Not assigned</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name} · {location.type}</option>)}</select></label>
        <label>Storage state<select value={storageState} onChange={e => setStorageState(e.target.value)}><option>CHILLED</option><option>FROZEN</option><option>AMBIENT</option></select></label>
        <label>Packed at<input type="datetime-local" value={packedAt} onChange={e => setPackedAt(e.target.value)} /></label>
        <label>Use-by / review date<input type="date" value={useByDate} onChange={e => setUseByDate(e.target.value)} /></label>
      </div>
      {existingOutputs.length > 0 && <div className="notice">This dispatch already has {existingOutputs.length} output line(s). Existing product names are locked against duplicate inventory; add only missing products.</div>}
      {!selectedEvent && batchId && <div className="notice">Record a slaughter event for this flock before creating traceable processing inventory.</div>}
      {withdrawalBlocked && <div className="notice">The selected slaughter event falls inside a medication withdrawal period. Processing is blocked.</div>}
      <div className="list">{rows.map((row, index) => { const recorded = existingProductNames.has(row.productName.trim().toLocaleLowerCase()); return <div className="card row" key={index}><div style={{flex:1}}><input aria-label={"Product "+index} value={row.productName} disabled={recorded} onChange={e => updateRow(index, { productName: e.target.value })}/><select aria-label={"Category "+index} value={row.category} disabled={recorded} onChange={e => updateRow(index, { category: e.target.value as Row["category"] })}><option>CARCASS</option><option>GIBLET</option><option>FEET</option><option>PART</option><option>BYPRODUCT</option><option>WASTE</option></select>{recorded&&<span className="muted">Already recorded for this slaughter dispatch</span>}</div><input aria-label={row.productName + " quantity"} type="number" min="0" step="0.001" value={row.quantity} disabled={recorded} placeholder={recorded?"Recorded":"Qty"} onChange={e => updateRow(index, { quantity: e.target.value })} /><input aria-label={row.productName + " unit price"} type="number" min="0" step="0.01" value={row.price} disabled={recorded} placeholder="Price" onChange={e => updateRow(index, { price: e.target.value })} /><input aria-label={row.productName + " total weight in kilograms"} type="number" min="0" step="0.001" value={row.weightKg} disabled={recorded} placeholder="Weight kg" onChange={e => updateRow(index, { weightKg: e.target.value })} /><button className="btn-tertiary" type="button" onClick={() => removeRow(index)}>Remove</button></div>; })}</div><button className="button" type="button" onClick={addRow}>Add product line</button>
      <button className="button button-primary" disabled={withdrawalBlocked || !selectedEvent || rows.every(row => existingProductNames.has(row.productName.trim().toLocaleLowerCase()) || !(Number(row.quantity) > 0))} type="submit">Save new processing outputs</button>
      {status && <span className="notice">{status}</span>}
    </form>
  </div>;
}