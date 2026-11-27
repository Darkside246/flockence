"use client";

import { useEffect, useState } from "react";

type Advice = {
  pen: { name: string; lengthM: number | null; widthM: number | null };
  flocks: { name: string; ageDays: number; live: number | null }[];
  areaM2: number | null; densityKgM2: number | null; ceilingKgM2: number | null; live: number | null; weightKg: number | null;
  recorded: { feeders: number | null; nipples: number | null; bellDrinkers: number | null; heaters: number | null };
  seen: { pictures: number; widePictures: number; feeders: number | null; drinkers: number | null; heaters: number | null };
  recommendations: { priority: number; text: string; basis: string }[];
  notes: string[];
};

const show = (n: number | null | undefined) => (n == null ? "—" : String(n));

/** Pen size and layout advice on the Farm Vision page: records, what the cameras saw, and what to change. */
export function PenLayout({ pens }: { pens: { id: string; name: string }[] }) {
  const [penId, setPenId] = useState("");
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (!penId && pens[0]) setPenId(pens[0].id); }, [pens, penId]);
  useEffect(() => {
    if (!penId) return;
    setError(""); setAdvice(null);
    fetch(`/api/vision/layout?penId=${encodeURIComponent(penId)}`, { cache: "no-store" }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not load the advice.");
      setAdvice(d.advice);
    }).catch((e) => setError(e instanceof Error ? e.message : "Could not load the advice."));
  }, [penId]);

  if (!pens.length) return <div className="card"><p>Add your pens on the <a href="/pens">Pens page</a> to get layout advice.</p></div>;
  return <div className="card pen-layout">
    <label>Pen<select value={penId} onChange={(e) => setPenId(e.target.value)}>{pens.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {error && <p role="alert" className="notice">{error}</p>}
    {advice && <>
      <div className="section stats">
        <div><span>Floor</span><strong>{advice.areaM2 ? `${advice.areaM2} m²` : "—"}</strong><small>{advice.pen.lengthM && advice.pen.widthM ? `${advice.pen.lengthM} × ${advice.pen.widthM} m (your records)` : "not entered"}</small></div>
        <div><span>Birds</span><strong>{show(advice.live)}</strong><small>{advice.flocks.map((f) => `${f.name}, day ${f.ageDays}`).join("; ") || "no flock in this pen"}</small></div>
        <div><span>Density</span><strong>{advice.densityKgM2 != null ? `${advice.densityKgM2} kg/m²` : "—"}</strong><small>{advice.ceilingKgM2 ? `ceiling ${advice.ceilingKgM2} kg/m²` : ""}</small></div>
        <div><span>Feeders</span><strong>{show(advice.recorded.feeders)} / {show(advice.seen.feeders)}</strong><small>recorded / seen</small></div>
        <div><span>Heaters</span><strong>{show(advice.recorded.heaters)} / {show(advice.seen.heaters)}</strong><small>recorded / seen</small></div>
      </div>
      {advice.recommendations.length ? <ol className="vision-intel-actions">{advice.recommendations.map((r, i) => <li key={i}>{r.text} <small className="muted">({r.basis})</small></li>)}</ol>
        : <p>Nothing to change from what is recorded and what the cameras showed.</p>}
      {advice.notes.length > 0 && <ul className="muted">{advice.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <p className="muted">From the last 7 days: {advice.seen.pictures} picture{advice.seen.pictures === 1 ? "" : "s"} of this pen, {advice.seen.widePictures} showing most of it. Vision does not measure the pen from pictures; size comes from your records on the <a href="/pens">Pens page</a>. Nothing here changes your records.</p>
    </>}
  </div>;
}
