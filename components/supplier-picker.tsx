"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL } from "@/lib/suppliers";

export type Supplier = { id: string; name: string; category: string; businessName?: string | null; phone?: string | null; whatsapp?: string | null; active?: boolean };

let cache: Promise<Supplier[]> | null = null;
/** One request for the list, shared by every picker on the page; refreshed after an add. */
export function loadSuppliers(refresh = false) {
  if (!cache || refresh) cache = fetch("/api/suppliers", { cache: "no-store" }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return cache;
}

/**
 * Type to find a supplier; if it is not there, add it with one tap (just the name; details can be filled in later on
 * the Suppliers page). Picking is optional: a purchase can be saved without a supplier.
 */
export function SupplierPicker({ value, onChange, category, label = "Supplier (optional)" }: { value: string; onChange: (id: string, s?: Supplier) => void; category?: string; label?: string }) {
  const [list, setList] = useState<Supplier[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { void loadSuppliers().then(setList); }, []);
  const chosen = list.find(s => s.id === value);
  useEffect(() => { if (chosen) setText(chosen.name); }, [chosen?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    const rank = (s: Supplier) => (category && s.category === category ? 0 : 1);
    return list.filter(s => !q || s.name.toLowerCase().includes(q) || (s.businessName ?? "").toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 8);
  }, [list, q, category]);
  const exact = list.some(s => s.name.toLowerCase() === q);

  async function addNew() {
    if (!q || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text.trim(), category: category ?? "OTHER" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not add the supplier.");
      const fresh = await loadSuppliers(true);
      setList(fresh); onChange(d.id, d); setText(d.name); setOpen(false);
      setMsg(d.existing ? `${d.name} was already on your list.` : `${d.name} added. Add phone or details later under Suppliers.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not add the supplier."); } finally { setBusy(false); }
  }

  return <div className="supplier-picker" ref={box} onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-expanded={open} aria-controls={id + "-list"} aria-autocomplete="list" value={text} placeholder="Type to find or add"
      onFocus={() => setOpen(true)} onChange={e => { setText(e.target.value); setOpen(true); if (value) onChange(""); }}
      onKeyDown={e => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && open) { e.preventDefault(); if (matches[0] && (exact || !q)) { onChange(matches[0].id, matches[0]); setText(matches[0].name); setOpen(false); } else if (q) void addNew(); } }} />
    {open && <ul id={id + "-list"} role="listbox" className="supplier-options">
      {matches.map(s => <li key={s.id} role="option" aria-selected={s.id === value}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(s.id, s); setText(s.name); setOpen(false); }}>{s.name}<small>{CATEGORY_LABEL[s.category] ?? s.category}{s.phone ? ` · ${s.phone}` : ""}</small></button></li>)}
      {q && !exact && <li role="option" aria-selected={false}><button type="button" className="supplier-add" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => void addNew()}>{busy ? "Adding…" : `+ Add “${text.trim()}” as a new supplier`}</button></li>}
      {!q && !matches.length && <li className="muted">No suppliers yet. Type a name to add one.</li>}
    </ul>}
    {value && <button type="button" className="button" onClick={() => { onChange(""); setText(""); }}>Clear</button>}
    {msg && <small className="muted" role="status">{msg}</small>}
  </div>;
}
