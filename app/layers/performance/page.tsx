"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type LayerBatch = {
  id: string;
  name: string;
  productionType?: string | null;
  species?: string;
  status: string;
  layerStage?: string | null;
};
type DailyRow = {
  date: string;
  layingFlocks: number;
  recordedFlocks: number;
  missingFlocks: number;
  complete: boolean;
  totalEggs: number;
  saleableEggs: number | null;
  nonSaleableEggs: number | null;
  liveHens: number | null;
  henDayProduction: number | null;
  saleableRate: number | null;
  averageEggMassPerHenG: number | null;
};
type FlockRow = {
  id: string;
  name: string;
  stage: string | null;
  status: string;
  initialHens: number;
  recordedMortalityToDate: number;
  survivalRate: number | null;
  latestRecordedLiveHens: number | null;
  eggsInWindow: number;
  saleableEggsInWindow: number;
  henHousedEggsToDate: number;
  cumulativeHenHousedProduction: number | null;
  periodHenDayProduction: number | null;
  saleableRate: number | null;
  feedKgInWindow: number;
  feedCostMinorInWindow: number;
  feedKgPerDozenSaleableEggs: number | null;
  recordedFeedCostPerDozenMinor: number | null;
  eggMassPerHenDayG: number | null;
};
type Performance = {
  window: { from: string; to: string; days: number };
  coverage: { layingFlocks: number; missingCollectionDays: number; completeDays: number; incompleteDays: number };
  summary: {
    eggsCollectedOnCompleteDays: number;
    saleableEggsOnCompleteDays: number;
    nonSaleableEggsOnCompleteDays: number;
    henDayProduction: number | null;
    saleableRate: number | null;
    feedKgRecorded: number;
    recordedFeedCostMinor: number;
    feedKgPerDozenSaleableEggs: number | null;
    recordedFeedCostPerDozenMinor: number | null;
    averageEggMassPerHenDayG: number | null;
  };
  daily: DailyRow[];
  byFlock: FlockRow[];
  notes: string[];
};
const initialTo = calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
const initialFromDate = new Date(`${initialTo}T00:00:00.000Z`);
initialFromDate.setUTCDate(initialFromDate.getUTCDate() - 29);
const initialFrom = initialFromDate.toISOString().slice(0, 10);
const num = (v: number | null | undefined, digits = 1) => v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
const fmtDate = (v: string) => new Date(Number(v.slice(0,4)),Number(v.slice(5,7))-1,Number(v.slice(8,10))).toLocaleDateString(undefined,{month:"short",day:"numeric"});
const fmtMoney = (minor: number | null | undefined) => minor == null ? "—" : new Intl.NumberFormat("en-BB",{style:"currency",currency:"BBD"}).format(minor/100);
const isLayer = (batch: LayerBatch) => batch.productionType === "LAYER" || String(batch.species || "").toUpperCase() === "LAYER";
async function readJson(response: Response) {
  const body = await response.text();
  const data = body ? JSON.parse(body) : null;
  if (!response.ok) throw new Error(data?.error || "Could not load layer performance.");
  return data;
}

export default function LayerPerformancePage() {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [batchId, setBatchId] = useState("");
  const [batches, setBatches] = useState<LayerBatch[]>([]);
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({from,to});
      if (batchId) params.set("batchId",batchId);
      const result = await readJson(await fetch("/api/layers/performance?"+params.toString(),{cache:"no-store"}));
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load layer performance.");
      setData(null);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    fetch("/api/batches",{cache:"no-store"}).then(readJson).then(rows => setBatches(Array.isArray(rows)?rows.filter(isLayer):[])).catch(()=>setBatches([]));
  },[]);
  useEffect(() => { void load(); },[]);
    const dailyTotal = data?.daily.reduce((sum,row)=>sum+row.totalEggs,0) ?? 0;
  const chartDays = (data?.daily || []).slice(-14);
  const chartMaxEggs = Math.max(1,...chartDays.map(row=>row.totalEggs));
  const selectedBatchName = batches.find(batch=>batch.id===batchId)?.name || "All layer flocks";

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Layer performance</h1><p>Production, quality, feed and survival in one view.</p></div><span className="badge">LAYER INSIGHTS</span></div></header>
    <Nav/>
    <main className="main">
      <section className="dashboard-head">
        <div><div className="hero-kicker">Production intelligence</div><h2>Understand your laying flock</h2><p>Use recorded egg collections and feed usage to see what is happening across the selected period.</p></div>
        <div className="header-actions"><a className="button" href="/layers">Daily egg round</a><a className="button button-primary" href="/layers/packing">Pack eggs</a></div>
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Reporting window</div><h3>Choose what to compare</h3><p>Up to 90 days. Historical rates use each collection's recorded live-hen count.</p></div><span className="badge">{selectedBatchName}</span></div>
        <div className="form grid2">
          <label>From<input type="date" value={from} max={to} onChange={event=>setFrom(event.target.value)}/></label>
          <label>To<input type="date" value={to} min={from} onChange={event=>setTo(event.target.value)}/></label>
          <label>Flock<select value={batchId} onChange={event=>setBatchId(event.target.value)}><option value="">All layer flocks</option>{batches.map(batch=><option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
          <div className="form"><span className="muted">Update the reporting window after changing a filter.</span><button className="button button-primary" disabled={loading || !from || !to || from>to} onClick={()=>void load()}>{loading?"Loading…":"Update performance"}</button></div>
        </div>
      </section>

      {error && <section className="section card" role="alert"><strong>Performance data unavailable</strong><p>{error}</p></section>}
      {loading && !data ? <section className="section card empty">Calculating layer performance…</section> : data && <>
        <section className="section dashboard-grid">
          <div className="card metric-card"><div className="metric-label">Hen-day production</div><div className="metric-value">{data.summary.henDayProduction==null?"—":num(data.summary.henDayProduction)+"%"}</div><div className="metric-foot">complete laying-flock days only</div></div>
          <div className="card metric-card"><div className="metric-label">Saleable egg rate</div><div className="metric-value">{data.summary.saleableRate==null?"—":num(data.summary.saleableRate)+"%"}</div><div className="metric-foot">{data.summary.saleableEggsOnCompleteDays.toLocaleString()} saleable eggs</div></div>
          <div className="card metric-card"><div className="metric-label">Cumulative hen-housed eggs</div><div className="metric-value">{data.byFlock.reduce((sum,row)=>sum+row.henHousedEggsToDate,0).toLocaleString()}</div><div className="metric-foot">since flock placement, all recorded history</div></div>
          <div className="card metric-card"><div className="metric-label">Feed recorded</div><div className="metric-value">{num(data.summary.feedKgRecorded)} kg</div><div className="metric-foot">recorded daily feed usage</div></div>
          <div className="card metric-card"><div className="metric-label">Feed per dozen saleable</div><div className="metric-value">{data.summary.feedKgPerDozenSaleableEggs==null?"—":num(data.summary.feedKgPerDozenSaleableEggs,2)+" kg"}</div><div className="metric-foot">feed usage divided by saleable dozens</div></div>
          <div className="card metric-card"><div className="metric-label">Recorded feed cost / dozen</div><div className="metric-value">{fmtMoney(data.summary.recordedFeedCostPerDozenMinor)}</div><div className="metric-foot">FeedUsage cost records only</div></div>
          <div className="card metric-card"><div className="metric-label">Average egg mass / hen / day</div><div className="metric-value">{data.summary.averageEggMassPerHenDayG==null?"—":num(data.summary.averageEggMassPerHenDayG,1)+" g"}</div><div className="metric-foot">sample egg weights must be recorded</div></div>
          <div className="card metric-card"><div className="metric-label">Complete collection days</div><div className="metric-value">{data.coverage.completeDays} / {data.window.days}</div><div className="metric-foot">{data.coverage.missingCollectionDays} flock-days missing a collection</div></div>
        </section>

        <section className="section card">
          <div className="section-head"><div><div className="hero-kicker">Egg output</div><h3>Daily production trend</h3><p>Most recent 14 days in the selected window · {dailyTotal.toLocaleString()} total eggs recorded across the full window</p></div><span className="badge">{data.coverage.incompleteDays} INCOMPLETE DAYS</span></div>
          <div className="layer-trend" role="group" aria-label="Daily egg output">
            {chartDays.map(day=>{
              const height=day.totalEggs>0?Math.max(4,day.totalEggs/chartMaxEggs*100):0;
              return <div className="layer-trend-day" key={day.date} aria-label={day.date+": "+day.totalEggs+" eggs"}>
                <strong className="layer-trend-count">{day.totalEggs>0?day.totalEggs.toLocaleString():"—"}</strong>
                <div className="layer-trend-track"><div className="layer-trend-bar" style={{height:height+"%"}}/></div>
                <span className="layer-trend-label">{fmtDate(day.date)}</span>
              </div>;
            })}
          </div>
          <div className="layer-trend-table">
            <div className="layer-trend-table-head"><span>Date</span><span>Hen-day</span><span>Saleable</span><span>Coverage</span></div>
            {data.daily.map(day=><div className="layer-trend-table-row" key={day.date}>
              <strong>{day.date}</strong><span>{day.henDayProduction==null?"—":num(day.henDayProduction)+"%"}</span><span>{day.saleableRate==null?"—":num(day.saleableRate)+"%"}</span>
              <span>{day.layingFlocks===0?"No laying flock":day.missingFlocks>0?day.missingFlocks+" missing":day.layingFlocks+"/"+day.layingFlocks+" complete"}</span>
            </div>)}
          </div>
        </section>

        <section className="section card">
          <div className="section-head"><div><div className="hero-kicker">Flock comparison</div><h3>How each layer flock is performing</h3><p>Rates are shown per flock. Blank figures mean source records are missing, not zero.</p></div><span className="badge">{data.byFlock.length} FLOCKS</span></div>
          {data.byFlock.length===0?<div className="empty"><strong>No layer flocks found</strong><span>Create a layer flock to begin recording layer performance.</span></div>:<div className="layer-performance-table">
            <div className="layer-performance-row layer-performance-header"><span>Flock</span><span>Stage</span><span>Hen-day</span><span>Hen-housed</span><span>Saleable</span><span>Survival</span><span>Feed / dozen</span></div>
            {data.byFlock.map(row=><div className="layer-performance-row" key={row.id}>
              <strong>{row.name}</strong><span>{row.stage?.replaceAll("_"," ")||"Not set"}</span>
              <span>{row.periodHenDayProduction==null?"—":num(row.periodHenDayProduction)+"%"}</span>
              <span>{row.cumulativeHenHousedProduction==null?"—":num(row.cumulativeHenHousedProduction)+"%"}</span>
              <span>{row.saleableRate==null?"—":num(row.saleableRate)+"%"}</span>
              <span>{row.survivalRate==null?"—":num(row.survivalRate)+"%"}</span>
              <span>{row.feedKgPerDozenSaleableEggs==null?"—":num(row.feedKgPerDozenSaleableEggs,2)+" kg"}</span>
            </div>)}
          </div>}
        </section>

        <section className="section card">
          <div className="section-head"><div><div className="hero-kicker">Data quality</div><h3>How to read these results</h3><p>Performance is only as reliable as the underlying farm entries.</p></div></div>
          <div className="list">{data.notes.map(note=><div className="row" style={{gridTemplateColumns:"20px 1fr"}} key={note}><span aria-hidden="true">•</span><span>{note}</span></div>)}</div>
        </section>
      </>}
    </main>
  </div>;
}
