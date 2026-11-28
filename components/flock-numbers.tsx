"use client";

import { FormEvent, useEffect, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

export type Ledger = {
  ok: boolean; error?: string; live?: number; bookBalance?: number; opening?: number; additions?: number; mortality?: number; culls?: number;
  slaughtered?: number; missing?: number; everInFlock?: number; basis?: string; houseWarning?: string | null;
  steps?: { label: string; change: number; balance: number; date: string | null }[];
  lastHeadCount?: { date: string; counted: number; expected: number; unaccounted: number } | null;
  houses?: { name: string; birds: number }[];
};

const today = () => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);

/** The flock's live birds on a date, from the server's ledger (the single source every page uses). */
export function useFlockLedger(batchId: string, date: string, revision = 0) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  useEffect(() => {
    setLedger(null);
    if (!batchId) return;
    const controller = new AbortController();
    fetch("/api/flock-ledger?" + new URLSearchParams({ batchId, ...(date ? { date } : {}) }), { cache: "no-store", signal: controller.signal })
      .then(r => r.json()).then(d => { if (!controller.signal.aborted) setLedger(d); }).catch(() => {});
    return () => controller.abort();
  }, [batchId, date, revision]);
  return ledger;
}

/** "18 live birds remaining", with the working one tap away. */
export function LiveBirdsPanel({ ledger, date }: { ledger: Ledger | null; date?: string }) {
  const [open, setOpen] = useState(false);
  if (!ledger) return null;
  if (!ledger.ok) return <p className="notice" role="status">{ledger.error ?? "The live bird count could not be worked out."}</p>;
  const steps = (ledger.steps ?? []).slice(1);
  return <div className="live-birds" role="status" aria-live="polite">
    <div className="live-birds-head">
      <strong className="live-birds-number">{ledger.live?.toLocaleString()}</strong>
      <span>live birds {date && date !== today() ? `on ${date}` : "remaining"}</span>
      <button type="button" className="button" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? "Hide working" : "How was this worked out?"}</button>
    </div>
    {open && <div className="live-birds-working">
      <p className="muted">{ledger.basis}</p>
      <table className="data-table"><tbody>
        <tr><th scope="row">Birds placed</th><td>{ledger.opening}</td><td /></tr>
        {steps.slice(-12).map((s, i) => <tr key={i}><th scope="row">{s.label}{s.date ? ` · ${s.date}` : ""}</th><td>{s.change > 0 ? "+" : ""}{s.change}</td><td>{s.balance}</td></tr>)}
        {ledger.lastHeadCount && <tr><th scope="row">Head count · {ledger.lastHeadCount.date}</th><td>{ledger.lastHeadCount.counted}</td><td>{ledger.lastHeadCount.unaccounted === 0 ? "matched the records" : `${Math.abs(ledger.lastHeadCount.unaccounted)} ${ledger.lastHeadCount.unaccounted < 0 ? "fewer" : "more"} than the records (not counted as deaths)`}</td></tr>}
      </tbody></table>
      {steps.length > 12 && <p className="muted">Showing the last 12 of {steps.length} changes.</p>}
      {(ledger.houses?.length ?? 0) > 1 && <p className="muted">By house: {ledger.houses!.map(h => `${h.name} ${h.birds}`).join(" · ")}{ledger.houseWarning ? ` (${ledger.houseWarning})` : ""}</p>}
    </div>}
  </div>;
}

type Batch = { id: string; name: string; status?: string };
const KINDS = [
  ["ADDITION", "Birds added to this flock"],
  ["TRANSFER", "Birds moved to another house"],
  ["CULLED", "Birds culled (removed on purpose)"],
  ["MISSING", "Birds missing (confirmed gone, cause unknown)"],
] as const;

/** Every change to bird numbers other than deaths at the round and slaughter, in one place. */
export function ChangeBirdNumbers({ batches }: { batches: Batch[] }) {
  const [houses, setHouses] = useState<string[]>([]);
  useEffect(() => { fetch("/api/pens").then(r => r.ok ? r.json() : []).then(rows => Array.isArray(rows) && setHouses(rows.filter((p: { active?: boolean }) => p.active !== false).map((p: { name: string }) => p.name))).catch(() => {}); }, []);
  const [batchId, setBatchId] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("ADDITION");
  const [date, setDate] = useState(today());
  const [quantity, setQuantity] = useState("");
  const [fromHouse, setFrom] = useState(""), [toHouse, setTo] = useState("");
  const [source, setSource] = useState(""), [cost, setCost] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [revision, setRevision] = useState(0);
  const ledger = useFlockLedger(batchId, date, revision);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg("");
    const submissionId = crypto.randomUUID();
    const isLoss = kind === "CULLED" || kind === "MISSING";
    const body = isLoss
      ? { batchId, date, quantity: Number(quantity), kind, reason: reason || null, submissionId }
      : { batchId, date, quantity: Number(quantity), type: kind, fromHouse: fromHouse || null, toHouse: toHouse || null, source: source || null, costMinor: cost ? Math.round(Number(cost) * 100) : null, notes: reason || null, submissionId };
    try {
      const r = await fetch(isLoss ? "/api/mortality" : "/api/bird-movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "That did not save.");
      setMsg(`Saved. ${d.liveBirdsNow != null ? `${d.liveBirdsNow} live birds in this flock now.` : ""}`);
      setQuantity(""); setReason(""); setSource(""); setCost(""); setRevision(v => v + 1);
    } catch (err) { setMsg(err instanceof Error ? err.message : "That did not save."); } finally { setBusy(false); }
  }

  return <form className="card form" onSubmit={submit}>
    <h3>Change bird numbers</h3>
    <p className="muted">For birds added, moved, culled or missing. Deaths found on the round go in the daily flock check. The live count updates itself.</p>
    <label>Flock<select value={batchId} onChange={e => setBatchId(e.target.value)} required><option value="">Select flock</option>{batches.filter(b => !b.status || b.status === "ACTIVE" || b.status === "CLOSED").map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <LiveBirdsPanel ledger={ledger} date={date} />
    <label>What happened<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <label>Date<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} required /></label>
    <label>Number of birds<input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
    {kind === "TRANSFER" && <>
      <label>From house<select value={fromHouse} onChange={e => setFrom(e.target.value)} required><option value="">Select</option>{houses.map(h => <option key={h}>{h}</option>)}</select></label>
      <label>To house<select value={toHouse} onChange={e => setTo(e.target.value)} required><option value="">Select</option>{houses.filter(h => h !== fromHouse).map(h => <option key={h}>{h}</option>)}</select></label>
    </>}
    {kind === "ADDITION" && <>
      <label>Where they came from<input value={source} onChange={e => setSource(e.target.value)} placeholder="Hatchery, supplier or own hatch" maxLength={120} /></label>
      <label>Into house (optional)<select value={toHouse} onChange={e => setTo(e.target.value)}><option value="">Not set</option>{houses.map(h => <option key={h}>{h}</option>)}</select></label>
      <label>Cost BBD (optional)<input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} /></label>
    </>}
    <label>{kind === "CULLED" || kind === "MISSING" ? "Reason (optional)" : "Note (optional)"}<input value={reason} onChange={e => setReason(e.target.value)} maxLength={120} /></label>
    {msg && <p className="notice" role="status">{msg}</p>}
    <button type="submit" className="button button-primary" disabled={busy || !batchId}>{busy ? "Saving…" : "Save"}</button>
  </form>;
}

type Insights = {
  ok: boolean; error?: string; ageDays?: number | null; days?: { date: string; live: number; feedKg: number | null; eatenKg: number | null; waterL: number | null; waterSource: string | null; losses: number; feedPerBirdG: number | null; eatenPerBirdG: number | null; waterPerBirdMl: number | null; waterToFeed: number | null }[];
  targetTemp?: { targetC: number; bandC: number; ageDays: number; source: string } | null;
  growth?: { ok: boolean; note?: string | null; model?: string; atAge?: { ageDays: number; kg: number; rangeKg: [number, number] | null } | null; reachesTargetAtAge?: number | null; basis?: string } | null;
  alerts?: { label: string; explanation: string }[]; heat?: { sensor: string; ok: boolean; maxC?: number; minC?: number; averageC?: number; hoursAbove?: number; degreeHoursAbove?: number; hoursWithoutReadings?: number; hoursAboveTarget?: number | null; hoursBelowTarget?: number | null }[];
  heatThresholdC?: number; missing?: string[];
};

/** Today's flock against its own last two weeks: what is unusual, what is missing, and the heat. */
export function FlockInsightsPanel({ batchId, revision = 0 }: { batchId: string; revision?: number }) {
  const [data, setData] = useState<Insights | null>(null);
  useEffect(() => {
    setData(null);
    if (!batchId) return;
    const controller = new AbortController();
    fetch("/api/flock-insights?" + new URLSearchParams({ batchId }), { cache: "no-store", signal: controller.signal }).then(r => r.json()).then(d => { if (!controller.signal.aborted) setData(d); }).catch(() => {});
    return () => controller.abort();
  }, [batchId, revision]);
  if (!data?.ok) return null;
  const week = (data.days ?? []).slice(-7);
  return <div className="flock-insights">
    {(data.alerts?.length ?? 0) > 0
      ? <ul className="insight-alerts">{data.alerts!.map(a => <li key={a.label}><strong>Unusual:</strong> {a.explanation}</li>)}</ul>
      : <p className="muted">Nothing unusual against this flock&apos;s last two weeks{(data.missing?.length ?? 0) ? " for what was recorded" : ""}.</p>}
    {data.targetTemp && <p className="muted">House target for day {data.targetTemp.ageDays}: about {data.targetTemp.targetC} °C ({data.targetTemp.source}; ±{data.targetTemp.bandC} °C counted as on target). A guide: the birds' behaviour comes first.</p>}
    {(data.heat ?? []).filter(h => h.ok).map(h => <p key={h.sensor} className="muted">{h.sensor}, last 24 hours: {h.minC}–{h.maxC} °C, average {h.averageC} °C{h.hoursAboveTarget ? `, ${h.hoursAboveTarget} h warmer than the target` : ""}{h.hoursBelowTarget ? `, ${h.hoursBelowTarget} h colder than the target` : ""}{h.hoursAbove ? `, ${h.hoursAbove} h above ${data.heatThresholdC} °C` : ""}{h.hoursWithoutReadings ? ` (${h.hoursWithoutReadings} h with no readings)` : ""}. Measured.</p>)}
    {data.growth?.ok && data.growth.atAge && <p className="muted">Weight forecast for day {data.growth.atAge.ageDays}: about {data.growth.atAge.kg} kg{data.growth.atAge.rangeKg ? ` (${data.growth.atAge.rangeKg[0]}–${data.growth.atAge.rangeKg[1]} kg)` : ""}{data.growth.reachesTargetAtAge != null ? `; reaches the target weight around day ${data.growth.reachesTargetAtAge}` : ""}. Forecast: {data.growth.basis}</p>}
    {data.growth && !data.growth.ok && <p className="muted" data-min="standard">{data.growth.note}</p>}
    {(data.missing ?? []).map(m => <p key={m} className="muted">{m}</p>)}
    <div data-min="standard" className="table-scroll"><table className="data-table">
      <thead><tr><th scope="col">Day</th><th scope="col">Live</th><th scope="col">Lost</th><th scope="col">Feed out / bird</th><th scope="col">Eaten / bird</th><th scope="col">Water / bird</th><th scope="col">Water : feed</th></tr></thead>
      <tbody>{week.map(d => <tr key={d.date}><th scope="row">{d.date.slice(5)}</th><td>{d.live}</td><td>{d.losses || "—"}</td><td>{d.feedPerBirdG != null ? d.feedPerBirdG + " g" : "—"}</td><td>{d.eatenPerBirdG != null ? d.eatenPerBirdG + " g" : "—"}</td><td>{d.waterPerBirdMl != null ? d.waterPerBirdMl + " ml" + (d.waterSource === "READING" ? " (meter)" : "") : "—"}</td><td>{d.waterToFeed ?? "—"}</td></tr>)}</tbody>
    </table></div>
  </div>;
}


/** Feed in the store and a water meter or tank reading, without opening the daily check. */
export function FeedAndWater({ batches }: { batches: Batch[] }) {
  const [store, setStore] = useState<{ inStoreKg: number; boughtKg: number; issuedKg: number; returnedKg: number; spiltKg: number } | null>(null);
  const [sources, setSources] = useState<{ source: string; kind: string; last: { readingL: number; readAt: string } }[]>([]);
  const [batchId, setBatchId] = useState(""), [source, setSource] = useState(""), [kind, setKind] = useState<"METER" | "TANK">("METER");
  const [reading, setReading] = useState(""), [added, setAdded] = useState(""), [other, setOther] = useState("");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [rev, setRev] = useState(0);
  useEffect(() => {
    fetch("/api/feed-ledger").then(r => r.ok ? r.json() : null).then(d => d?.store && setStore(d.store)).catch(() => {});
    fetch("/api/water-readings").then(r => r.ok ? r.json() : null).then(d => Array.isArray(d?.sources) && setSources(d.sources)).catch(() => {});
  }, [rev]);
  const last = sources.find(x => x.source === source && x.kind === kind)?.last;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/water-readings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: batchId || null, source, kind, readingL: Number(reading), addedL: added === "" ? null : Number(added), otherUseL: other === "" ? null : Number(other), submissionId: crypto.randomUUID() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "That did not save.");
      setMsg(d.usedSinceLast?.litres != null ? `Saved. ${d.usedSinceLast.litres} L used since the last reading.` : d.usedSinceLast?.note ?? d.note ?? "Saved.");
      setReading(""); setAdded(""); setOther(""); setRev(v => v + 1);
    } catch (err) { setMsg(err instanceof Error ? err.message : "That did not save."); } finally { setBusy(false); }
  }
  return <form className="card form" onSubmit={submit}>
    <h3>Feed and water</h3>
    {store && <p><strong>{store.inStoreKg.toLocaleString()} kg</strong> of feed in the store <span className="muted">(bought {store.boughtKg} kg − put out {store.issuedKg} kg + taken back {store.returnedKg} kg{store.spiltKg ? `; ${store.spiltKg} kg spilt or spoiled` : ""}). Worked out from your records.</span></p>}
    <label>Flock (optional)<select value={batchId} onChange={e => setBatchId(e.target.value)}><option value="">Whole farm</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <label>Meter or tank<input value={source} onChange={e => setSource(e.target.value)} list="water-sources" placeholder="For example: House 1 meter" maxLength={80} required /></label>
    <datalist id="water-sources">{[...new Set(sources.map(x => x.source))].map(x => <option key={x} value={x} />)}</datalist>
    <label>Type<select value={kind} onChange={e => setKind(e.target.value as "METER" | "TANK")}><option value="METER">Meter dial (total litres)</option><option value="TANK">Tank level (litres in the tank)</option></select></label>
    <label>Reading litres<input type="number" min="0" step="0.1" value={reading} onChange={e => setReading(e.target.value)} required />{last && <span className="muted">Last reading {last.readingL} L on {String(last.readAt).slice(0, 10)}.</span>}</label>
    {kind === "TANK" && <>
      <label>Refilled since the last reading litres<input type="number" min="0" step="0.1" value={added} onChange={e => setAdded(e.target.value)} placeholder="0" /></label>
      <label>Used for other things litres (cleaning, people)<input type="number" min="0" step="0.1" value={other} onChange={e => setOther(e.target.value)} placeholder="0" /></label>
    </>}
    {msg && <p className="notice" role="status">{msg}</p>}
    <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save reading"}</button>
  </form>;
}

type Waste = {
  from: string; to: string; deadBirds: Record<string, Record<string, number>>;
  processing: { outputsRecorded: boolean; dressedOnly: boolean; slaughterEventId: string; flock: string; date: string; birds: number; condemnedBirds: number; edibleKg: number; byproductKg: number; wasteKg: number; yieldPercent: number | null; unaccountedKg: number | null; unweighedOutputs: number; byproductHandlingKg: Record<string, number> }[];
  eggs: { collected: number; cracked: number; broken: number; rejected: number; dirty: number; floor: number };
  feedSpiltKg: number; manure: { material: string; quantity: number; unit: string; disposition: string }[];
  stockWrittenOff: { type: string; quantity: number; unit: string; weightKg: number | null }[];
};
const DISPOSAL_LABEL: Record<string, string> = { BURIED: "buried", BURNED: "burned", COMPOSTED: "composted", RENDERED: "rendered", COLLECTED: "collected", NOT_RECORDED: "disposal not recorded" };
const KIND_LABEL: Record<string, string> = { DIED: "Died", CULLED: "Culled", MISSING: "Missing" };

/** Waste and by-products over the last 30 days, from the records already kept. */
export function WasteSummary() {
  const [w, setW] = useState<Waste | null>(null);
  useEffect(() => { fetch("/api/waste-summary?days=30").then(r => r.ok ? r.json() : null).then(setW).catch(() => {}); }, []);
  if (!w) return null;
  const birds = Object.entries(w.deadBirds);
  return <div className="card">
    <h3>Waste and by-products, last 30 days</h3>
    <p className="muted">From the records you already keep. Where an output was not weighed, the gap is shown, not guessed.</p>
    <ul className="waste-list">
      <li><strong>Birds lost:</strong> {birds.length ? birds.map(([k, by]) => `${KIND_LABEL[k] ?? k} ${Object.values(by).reduce((a, b) => a + b, 0)} (${Object.entries(by).map(([d, n]) => `${n} ${DISPOSAL_LABEL[d] ?? d.toLowerCase()}`).join(", ")})`).join(" · ") : "none recorded"}</li>
      {w.processing.map(p => <li key={p.slaughterEventId}><strong>{p.flock}, {p.date}:</strong> {!p.outputsRecorded && !p.dressedOnly ? "no dressed weight or processing pack recorded yet" : <>{p.edibleKg} kg food{p.dressedOnly ? " (dressed weight; processing pack not recorded)" : ""}, {p.byproductKg} kg by-products, {p.wasteKg} kg waste{p.yieldPercent != null ? ` · yield ${p.yieldPercent}%` : ""}{p.unaccountedKg != null ? ` · ${p.unaccountedKg} kg of the live weight not accounted for (water lost in chilling, blood and feathers not weighed)` : " · live weight not weighed, so the unaccounted part is not known"}{p.unweighedOutputs ? ` · ${p.unweighedOutputs} output(s) not weighed` : ""}{p.condemnedBirds ? ` · ${p.condemnedBirds} birds condemned` : ""}{Object.keys(p.byproductHandlingKg).length ? ` · by-products and waste: ${Object.entries(p.byproductHandlingKg).map(([s, kg]) => `${kg} kg ${s.toLowerCase()}`).join(", ")}` : ""}</>}</li>)}
      <li><strong>Eggs:</strong> {w.eggs.cracked + w.eggs.broken + w.eggs.rejected} damaged or rejected of {w.eggs.collected} ({w.eggs.cracked} cracked, {w.eggs.broken} broken, {w.eggs.rejected} rejected){w.eggs.dirty ? `, ${w.eggs.dirty} dirty` : ""}{w.eggs.floor ? `, ${w.eggs.floor} floor eggs` : ""}</li>
      <li><strong>Feed spilt or spoiled:</strong> {w.feedSpiltKg} kg</li>
      {w.manure.length > 0 && <li><strong>Manure and litter:</strong> {w.manure.map(m => `${m.quantity} ${m.unit} ${m.material.toLowerCase()} (${m.disposition.toLowerCase()})`).join(" · ")}</li>}
      {w.stockWrittenOff.length > 0 && <li><strong>Stock written off:</strong> {w.stockWrittenOff.map(x => `${x.quantity} ${x.unit}${x.weightKg ? ` (${x.weightKg} kg)` : ""} ${x.type === "DAMAGE" ? "damaged" : "disposed"}`).join(" · ")}</li>}
    </ul>
  </div>;
}
