"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";
import { useSession } from "@/components/auth-gate";
import { CATEGORY_LABEL, SUPPLIER_CATEGORIES } from "@/lib/suppliers";
import { loadSuppliers } from "@/components/supplier-picker";

type Supplier = { id: string; name: string; category: string; businessName: string | null; contactPerson: string | null; phone: string | null; whatsapp: string | null; email: string | null; location: string | null; productsSupplied: string | null; notes: string | null; active: boolean };
const blank = { name: "", category: "FEED", businessName: "", contactPerson: "", phone: "", whatsapp: "", email: "", location: "", productsSupplied: "", notes: "" };

/** Everyone who supplies the farm, by kind; added here or in the middle of a purchase. */
export default function SuppliersPage() {
  const session = useSession();
  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";
  const [rows, setRows] = useState<Supplier[]>([]);
  const [q, setQ] = useState(""), [cat, setCat] = useState(""), [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<typeof blank & { id?: string; customCategory?: string }>(blank);
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const load = () => fetch("/api/suppliers?all=1", { cache: "no-store" }).then(r => r.json()).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); }).catch(() => { setMsg("Suppliers could not be loaded."); setLoading(false); });
  useEffect(() => { void load(); }, []);
  const categories = useMemo(() => [...new Set([...SUPPLIER_CATEGORIES, ...rows.map(r => r.category)])], [rows]);
  const shown = rows.filter(r => (showInactive || r.active) && (!cat || r.category === cat) && (!q || `${r.name} ${r.businessName ?? ""} ${r.productsSupplied ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg("");
    const category = form.category === "__custom" ? (form.customCategory ?? "").trim() || "OTHER" : form.category;
    try {
      const r = await fetch(form.id ? "/api/suppliers?id=" + form.id : "/api/suppliers", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, category }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not save.");
      setMsg(d.existing ? `${d.name} is already on the list; open it below to edit.` : form.id ? "Saved." : `${d.name} added.`);
      setForm(blank); await load(); void loadSuppliers(true);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Could not save."); } finally { setBusy(false); }
  }
  async function setActive(s: Supplier, active: boolean) {
    const r = await fetch("/api/suppliers?id=" + s.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
    if (r.ok) { setMsg(`${s.name} ${active ? "is active again" : "is now inactive (kept in old records)"}.`); await load(); void loadSuppliers(true); }
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  return <div className="shell"><Nav /><main className="main">
    <header className="dashboard-head"><div><div className="hero-kicker">Business</div><h2>Suppliers and dealers</h2><p className="muted">Hatcheries, feed dealers, vets, processors and anyone else you buy from. Purchases can also add a supplier as you go.</p></div></header>
    {msg && <p className="notice" role="status">{msg}</p>}
    {canEdit && <form className="card form grid2" onSubmit={save}>
      <h3 className="span-2">{form.id ? `Edit ${form.name}` : "Add a supplier"}</h3>
      <label>Name<input value={form.name} onChange={set("name")} required maxLength={120} placeholder="Dealer or person's name" /></label>
      <label>Kind of supplier<select value={categories.includes(form.category) ? form.category : "__custom"} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
        {categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}<option value="__custom">Another kind…</option></select></label>
      {form.category === "__custom" && <label>Name this kind<input value={form.customCategory ?? ""} onChange={set("customCategory")} maxLength={40} placeholder="e.g. Packaging" /></label>}
      <label>Business name<input value={form.businessName} onChange={set("businessName")} maxLength={160} /></label>
      <label>Contact person<input value={form.contactPerson} onChange={set("contactPerson")} maxLength={120} /></label>
      <label>Phone<input value={form.phone} onChange={set("phone")} inputMode="tel" maxLength={40} /></label>
      <label>WhatsApp<input value={form.whatsapp} onChange={set("whatsapp")} inputMode="tel" maxLength={40} /></label>
      <label>Email<input value={form.email} onChange={set("email")} type="email" maxLength={120} /></label>
      <label>Location<input value={form.location} onChange={set("location")} maxLength={160} /></label>
      <label className="span-2">What they supply<input value={form.productsSupplied} onChange={set("productsSupplied")} maxLength={400} placeholder="e.g. Super Feeds broiler grower, 30 kg bags" /></label>
      <label className="span-2">Notes<textarea value={form.notes} onChange={set("notes")} maxLength={1000} rows={2} /></label>
      <div className="row-actions span-2"><button type="submit" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add supplier"}</button>{form.id && <button type="button" className="button" onClick={() => setForm(blank)}>Cancel</button>}</div>
    </form>}
    <section className="section card">
      <div className="toolbar-row">
        <label>Find<input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, business or product" /></label>
        <label>Kind<select value={cat} onChange={e => setCat(e.target.value)}><option value="">All kinds</option>{categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}</select></label>
        <label className="check-line"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>
      {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">{rows.length ? "No suppliers match." : "No suppliers yet. Add one above, or while recording a purchase."}</p> :
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Contact</th><th scope="col">Supplies</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{shown.map(s => <tr key={s.id} className={s.active ? "" : "row-inactive"}>
            <th scope="row">{s.name}{s.businessName ? <small className="muted"> · {s.businessName}</small> : null}{!s.active && <small className="muted"> (inactive)</small>}</th>
            <td>{CATEGORY_LABEL[s.category] ?? s.category}</td>
            <td>{[s.contactPerson, s.phone, s.whatsapp && `WhatsApp ${s.whatsapp}`, s.email].filter(Boolean).join(" · ") || "—"}</td>
            <td>{s.productsSupplied || "—"}</td>
            <td>{canEdit && <div className="row-actions"><button type="button" className="button" onClick={() => { setForm({ ...blank, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? ""])), id: s.id } as never); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
              <button type="button" className="button" onClick={() => void setActive(s, !s.active)}>{s.active ? "Make inactive" : "Make active"}</button></div>}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </main></div>;
}
