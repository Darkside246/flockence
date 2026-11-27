"use client";

import { FormEvent, useEffect, useState } from "react";
import { loadFeedProducts } from "@/components/feed-type-picker";
import { loadSuppliers, SupplierPicker, type Supplier } from "@/components/supplier-picker";

type Product = { id: string; brand: string; name: string; description: string | null; defaultBagKg: number | null; preferredSupplierId: string | null; active: boolean; suppliers: { supplierId: string; supplier: { name: string }; bagSizeKg: string | null; unitCostMinor: number | null }[] };
type Measure = { id: string; name: string; kind: string; kgPerUnit: number | null; active: boolean };

/** The farm's feed catalogue (kept from the built-in list, now editable) and its own feed measures. */
export function FeedSettings() {
  const [products, setProducts] = useState<Product[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState({ brand: "", name: "", defaultBagKg: "" });
  const [measure, setMeasure] = useState({ name: "", kind: "SCOOP", kgPerUnit: "" });
  const [showOff, setShowOff] = useState(false), [msg, setMsg] = useState("");
  const load = async () => {
    const [p, m] = await Promise.all([fetch("/api/feed-products?all=1", { cache: "no-store" }).then(r => r.json()), fetch("/api/feed-measures", { cache: "no-store" }).then(r => r.json())]);
    setProducts(Array.isArray(p) ? p : []); setMeasures(Array.isArray(m) ? m : []);
    void loadFeedProducts(true);
  };
  useEffect(() => { void load(); void loadSuppliers().then(setSuppliers); }, []);
  const call = async (url: string, method: string, body: unknown, done: string) => {
    setMsg("");
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || "Could not save."); return false; }
    setMsg(d.existing ? "That feed is already in the catalogue." : done); await load(); return true;
  };
  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await call("/api/feed-products?id=" + editing.id, "PATCH", { brand: editing.brand, name: editing.name, description: editing.description, defaultBagKg: editing.defaultBagKg ?? "", preferredSupplierId: editing.preferredSupplierId ?? "", active: editing.active, suppliers: editing.suppliers.map(s => ({ supplierId: s.supplierId, bagSizeKg: s.bagSizeKg, unitCostMinor: s.unitCostMinor })) }, `${editing.name} saved.`);
    if (ok) setEditing(null);
  }
  const groups = [...new Set(products.map(p => p.brand || "Your own feeds"))];
  return <div className="form">
    {msg && <p className="notice" role="status">{msg}</p>}
    <h3>Feed catalogue</h3>
    <p className="muted">Your feeds, kept from the built-in Pinnacle and Super Feeds list. Rename, add, set the usual bag size, link the dealers who sell each one, or switch off feeds you no longer use. Old records keep their feed names.</p>
    <label className="check-line"><input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> Show switched-off feeds</label>
    {groups.map(g => <details key={g} className="feed-group"><summary>{g} ({products.filter(p => (p.brand || "Your own feeds") === g && (showOff || p.active)).length})</summary>
      <ul className="feed-list">{products.filter(p => (p.brand || "Your own feeds") === g && (showOff || p.active)).map(p => <li key={p.id} className={p.active ? "" : "row-inactive"}>
        <span><strong>{p.name}</strong>{p.defaultBagKg ? ` · ${p.defaultBagKg} kg bag` : " · bag size not set"}{p.suppliers.length ? ` · from ${p.suppliers.map(s => s.supplier.name).join(", ")}` : ""}{!p.active && " · switched off"}</span>
        <button type="button" className="button" onClick={() => setEditing({ ...p })}>Edit</button>
      </li>)}</ul>
    </details>)}
    {editing && <form className="card form grid2" onSubmit={saveProduct}>
      <h4 className="span-2">Edit {editing.name}</h4>
      <label>Brand<input value={editing.brand} onChange={e => setEditing({ ...editing, brand: e.target.value })} maxLength={160} placeholder="Empty for your own mix" /></label>
      <label>Feed name<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} required maxLength={160} /></label>
      <label>Usual bag size kg<input type="number" min="0.1" step="0.1" value={editing.defaultBagKg ?? ""} onChange={e => setEditing({ ...editing, defaultBagKg: e.target.value === "" ? null : Number(e.target.value) })} placeholder="e.g. 30" /></label>
      <label>Preferred dealer<select value={editing.preferredSupplierId ?? ""} onChange={e => setEditing({ ...editing, preferredSupplierId: e.target.value || null })}><option value="">None</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="span-2">Description<input value={editing.description ?? ""} onChange={e => setEditing({ ...editing, description: e.target.value })} maxLength={400} /></label>
      <div className="span-2"><strong>Dealers who sell it</strong>
        <ul className="feed-list">{editing.suppliers.map(s => <li key={s.supplierId}><span>{s.supplier.name}{s.bagSizeKg ? ` · ${Number(s.bagSizeKg)} kg bag` : ""}{s.unitCostMinor != null ? ` · ${(s.unitCostMinor / 100).toFixed(2)} a bag` : ""}</span><button type="button" className="button" onClick={() => setEditing({ ...editing, suppliers: editing.suppliers.filter(x => x.supplierId !== s.supplierId) })}>Remove</button></li>)}</ul>
        <SupplierPicker value="" category="FEED" label="Add a dealer" onChange={(id, sup) => { if (id && sup && !editing.suppliers.some(x => x.supplierId === id)) setEditing({ ...editing, suppliers: [...editing.suppliers, { supplierId: id, supplier: { name: sup.name }, bagSizeKg: null, unitCostMinor: null }] }); }} />
      </div>
      <label className="check-line span-2"><input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> In use (switched-off feeds stay in old records but are not offered)</label>
      <div className="row-actions span-2"><button type="submit">Save feed</button><button type="button" className="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}
    <form className="grid2" onSubmit={async e => { e.preventDefault(); if (await call("/api/feed-products", "POST", adding, `${adding.name} added.`)) setAdding({ brand: "", name: "", defaultBagKg: "" }); }}>
      <h4 className="span-2">Add a feed</h4>
      <label>Brand<input value={adding.brand} onChange={e => setAdding({ ...adding, brand: e.target.value })} maxLength={160} placeholder="e.g. Super Feeds" /></label>
      <label>Feed name<input value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} required maxLength={160} /></label>
      <label>Usual bag size kg<input type="number" min="0.1" step="0.1" value={adding.defaultBagKg} onChange={e => setAdding({ ...adding, defaultBagKg: e.target.value })} /></label>
      <div className="row-actions"><button type="submit">Add feed</button></div>
    </form>

    <h3>Your feed measures</h3>
    <p className="muted">If you feed by the scoop, pan or bucket, add it here and weigh one full measure once. Flockence never guesses what a scoop holds; until you enter it, that measure cannot be turned into kilograms.</p>
    <ul className="feed-list">{measures.map(m => <li key={m.id} className={m.active ? "" : "row-inactive"}>
      <span><strong>{m.name}</strong> · {m.kgPerUnit ? `${m.kgPerUnit} kg each` : "weight not set yet"}</span>
      <span className="row-actions">
        <button type="button" className="button" onClick={() => { const v = window.prompt(`How many kg does one ${m.name.toLowerCase()} hold?`, m.kgPerUnit ? String(m.kgPerUnit) : ""); if (v !== null && v.trim() !== "") void call("/api/feed-measures?id=" + m.id, "PATCH", { kgPerUnit: Number(v) }, `${m.name} saved.`); }}>Set weight</button>
        <button type="button" className="button" onClick={() => void call("/api/feed-measures?id=" + m.id, "PATCH", { active: !m.active }, `${m.name} ${m.active ? "switched off" : "in use"}.`)}>{m.active ? "Switch off" : "Use again"}</button>
      </span>
    </li>)}</ul>
    <form className="grid2" onSubmit={async e => { e.preventDefault(); if (await call("/api/feed-measures", "POST", { ...measure, kgPerUnit: measure.kgPerUnit === "" ? null : Number(measure.kgPerUnit) }, `${measure.name} added.`)) setMeasure({ name: "", kind: "SCOOP", kgPerUnit: "" }); }}>
      <label>Name<input value={measure.name} onChange={e => setMeasure({ ...measure, name: e.target.value })} required maxLength={60} placeholder="e.g. Red scoop, Feeder pan" /></label>
      <label>Kind<select value={measure.kind} onChange={e => setMeasure({ ...measure, kind: e.target.value })}><option value="SCOOP">Scoop</option><option value="PAN">Pan</option><option value="FEEDER">Feeder fill</option><option value="BUCKET">Bucket</option><option value="OTHER">Other</option></select></label>
      <label>One holds kg (if weighed)<input type="number" min="0.01" step="0.01" value={measure.kgPerUnit} onChange={e => setMeasure({ ...measure, kgPerUnit: e.target.value })} /></label>
      <div className="row-actions"><button type="submit">Add measure</button></div>
    </form>
  </div>;
}
