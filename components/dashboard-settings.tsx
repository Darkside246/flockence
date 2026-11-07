"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_SECTIONS } from "@/lib/dashboard-sections";

/** Which sections the dashboard shows. Hidden sections are not loaded, which also makes the dashboard faster. */
export function DashboardSettings() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(d => {
      const v = (d.settings ?? []).find((x: { key: string }) => x.key === "dashboard_hidden")?.value;
      try { const list = JSON.parse(v ?? "[]"); if (Array.isArray(list)) setHidden(list); } catch { /* keep defaults */ }
      setLoaded(true);
    }).catch(() => setMsg("Settings could not be loaded."));
  }, []);
  async function save() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: [{ key: "dashboard_hidden", value: JSON.stringify(hidden) }] }) });
    setBusy(false);
    setMsg(r.ok ? "Dashboard saved. It applies the next time the dashboard opens." : "Could not save. Try again.");
  }
  return <div className="form">
    <p className="muted">Tick what you want to see on the dashboard. Everything is shown until you change it.</p>
    <div className="dash-choices">{DASHBOARD_SECTIONS.map(s => <label key={s.id} className="check-line">
      <input type="checkbox" disabled={!loaded} checked={!hidden.includes(s.id)} onChange={e => setHidden(h => (e.target.checked ? h.filter(x => x !== s.id) : [...h, s.id]))} />
      <span><strong>{s.label}</strong><small className="muted"> {s.hint}</small></span>
    </label>)}</div>
    <div className="row-actions"><button type="button" onClick={() => void save()} disabled={!loaded || busy}>{busy ? "Saving…" : "Save dashboard"}</button><button type="button" className="button" onClick={() => setHidden([])}>Show everything</button></div>
    {msg && <p className="notice" role="status">{msg}</p>}
  </div>;
}
