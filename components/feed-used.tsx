"use client";

import { FormEvent, useEffect, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
import { FeedTypePicker, type FeedProduct } from "@/components/feed-type-picker";

type Batch = { id: string; name: string; status?: string };
type Measure = { id: string; name: string; kgPerUnit: number | null; active: boolean };
type Summary = { totalKg: number; bags: number | null; bagKg: number | null; costMinor: number; perBirdPlacedKg: number | null; kgPerBirdDay: number | null; fcr: { value: number; method: string } | null; fcrNote: string | null };
const today = () => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
const remember = (k: string, v: string) => { try { localStorage.setItem("flockence-feed-" + k, v); } catch { /* storage blocked */ } };
const recall = (k: string) => { try { return localStorage.getItem("flockence-feed-" + k) ?? ""; } catch { return ""; } };

/**
 * Record feed used in a few seconds, counted the way this farm counts it: bags, kilograms, grams, pounds, or the
 * farm's own scoop or pan. Remembers the last flock, feed and way of counting.
 */
export function FeedUsed({ batches }: { batches: Batch[] }) {
  const [batchId, setBatchId] = useState(""), [date, setDate] = useState(today());
  const [feedType, setFeedType] = useState(""), [product, setProduct] = useState<FeedProduct | null>(null);
  const [unit, setUnit] = useState("BAG"), [measureId, setMeasureId] = useState(""), [amount, setAmount] = useState("");
  const [measures, setMeasures] = useState<Measure[]>([]), [farmBagKg, setFarmBagKg] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [rev, setRev] = useState(0);
  useEffect(() => {
    setBatchId(recall("batch")); setUnit(recall("unit") || ""); setMeasureId(recall("measure"));
    fetch("/api/feed-measures").then(r => r.ok ? r.json() : []).then(m => Array.isArray(m) && setMeasures(m.filter((x: Measure) => x.active))).catch(() => {});
    fetch("/api/settings").then(r => r.ok ? r.json() : null).then(d => {
      const map = Object.fromEntries((d?.settings ?? []).map((x: { key: string; value: string }) => [x.key, x.value]));
      if (Number(map.default_bag_kg) > 0) setFarmBagKg(Number(map.default_bag_kg));
      setUnit(u => u || map.feed_record_method || "BAG");
    }).catch(() => setUnit(u => u || "BAG"));
  }, []);
  useEffect(() => {
    setSummary(null);
    if (!batchId) return;
    fetch("/api/feed-ledger?batchId=" + encodeURIComponent(batchId), { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => setSummary(d?.summary ?? null)).catch(() => {});
  }, [batchId, rev]);
  const bagKg = product?.defaultBagKg ?? farmBagKg;
  const measure = measures.find(m => m.id === measureId);
  const preview = (() => {
    const q = Number(amount);
    if (!amount || !Number.isFinite(q)) return "";
    if (unit === "BAG") return bagKg ? `= ${Math.round(q * bagKg * 1000) / 1000} kg (${bagKg} kg bags)` : "Set the bag size for this feed, or the farm's usual bag size in Settings.";
    if (unit === "LB") return `= ${Math.round(q * 0.45359237 * 1000) / 1000} kg`;
    if (unit === "G") return `= ${q / 1000} kg`;
    if (unit === "MEASURE") return measure?.kgPerUnit ? `= ${Math.round(q * measure.kgPerUnit * 1000) / 1000} kg (${measure.kgPerUnit} kg each)` : measure ? `How much one ${measure.name.toLowerCase()} holds is not set yet (Settings, Feed).` : "";
    return "";
  })();

  async function submit(e: FormEvent, quick?: number) {
    e.preventDefault();
    if (busy) return;
    const qty = quick ?? Number(amount);
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/feed-usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, date, amount: qty, unit, measureId: unit === "MEASURE" ? measureId : null, feedProductId: product?.id ?? null, submissionId: crypto.randomUUID() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "That did not save.");
      remember("batch", batchId); remember("unit", unit); if (unit === "MEASURE") remember("measure", measureId);
      setMsg(`Saved: ${d.basis} = ${d.quantityKg} kg.${d.costKnown ? "" : " Cost not known yet (no feed purchase recorded)."}`);
      setAmount(""); setRev(v => v + 1);
    } catch (err) { setMsg(err instanceof Error ? err.message : "That did not save."); } finally { setBusy(false); }
  }

  return <form className="card form" onSubmit={e => submit(e)}>
    <h3>Feed used</h3>
    <label>Flock<select value={batchId} onChange={e => setBatchId(e.target.value)} required><option value="">Select flock</option>{batches.filter(b => !b.status || b.status === "ACTIVE").map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <FeedTypePicker value={feedType} onChange={setFeedType} onProduct={setProduct} required={false} />
    <label>Counted in<select value={unit} onChange={e => setUnit(e.target.value)}>
      <option value="BAG">Bags{bagKg ? ` (${bagKg} kg)` : ""}</option><option value="KG">Kilograms</option><option value="LB">Pounds</option><option value="G">Grams</option>
      {measures.length > 0 && <option value="MEASURE">My measures (scoop, pan…)</option>}
    </select></label>
    {unit === "MEASURE" && <label>Which measure<select value={measureId} onChange={e => setMeasureId(e.target.value)} required><option value="">Choose</option>{measures.map(m => <option key={m.id} value={m.id}>{m.name}{m.kgPerUnit ? ` (${m.kgPerUnit} kg)` : " (weight not set)"}</option>)}</select></label>}
    {unit === "BAG" && <div className="quick-amounts" role="group" aria-label="Quick amounts">
      {[0.5, 1, 1.5, 2].map(q => <button key={q} type="button" className="button" disabled={!batchId || busy || !bagKg} onClick={e => submit(e as unknown as FormEvent, q)}>{q === 0.5 ? "½ bag" : q === 1.5 ? "1½ bags" : `${q} bag${q === 1 ? "" : "s"}`}</button>)}
    </div>}
    <label>How many<input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} required={!busy} />{preview && <span className="muted">{preview}</span>}</label>
    <label>Date<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} required /></label>
    {msg && <p className="notice" role="status">{msg}</p>}
    <button type="submit" disabled={busy || !batchId}>{busy ? "Saving…" : "Save feed used"}</button>
    {summary && summary.totalKg > 0 && <p className="muted">
      This flock has used {summary.bags != null ? `${summary.bags} bags (${summary.totalKg} kg)` : `${summary.totalKg} kg`}{summary.costMinor ? `, costing ${(summary.costMinor / 100).toFixed(2)}` : ""}
      {summary.perBirdPlacedKg != null ? ` · ${summary.perBirdPlacedKg} kg per bird placed` : ""}{summary.kgPerBirdDay != null ? ` · ${Math.round(summary.kgPerBirdDay * 1000)} g per bird per day` : ""}.
      {summary.fcr ? ` Feed conversion ${summary.fcr.value} (${summary.fcr.method})` : summary.fcrNote ? ` ${summary.fcrNote}` : ""}
    </p>}
  </form>;
}
