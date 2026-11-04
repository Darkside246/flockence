"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";

type Broiler = {
  id: string; name: string; liveBirds: number; mortalityPercent: number | null;
  latestLiveWeightKg: number | null; targetLiveWeightKg: number | null; weightGapKg: number | null;
  intervalFcr: number | null; dressingYieldPercent: number | null; expectedHarvestDate: string | null;
  daysToHarvest: number | null; feedUsed7dKg: number; feedCost7dMinor: number; signals: string[];
};
type Layer = {
  id: string; name: string; liveHens: number;
  sevenDay: {
    eggs: number; saleableEggs: number; henDayProduction: number | null; saleableRate: number | null;
    feedKg: number; feedKgPerDozen: number | null; feedCostPerDozenMinor: number | null;
    eggsPerHen: number | null; withdrawalBlockedCollections: number; collectionCoverage: number;
  };
  signals: string[];
};
type Performance = {
  asOf: string;
  farm: { activeBroilerFlocks: number; activeLayerFlocks: number; liveBroilers: number; liveLayerHens: number };
  broilers: Broiler[]; layers: Layer[];
  dataQuality: { note: string };
};

const money = (minor: number | null) => minor == null ? "—" : new Intl.NumberFormat("en-BB", { style: "currency", currency: "BBD" }).format(minor / 100);
const signalLabel = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/(^| )\w/g, (m) => m.toUpperCase());

async function json(response: Response) {
  const body = await response.text();
  const data = body ? JSON.parse(body) : null;
  if (!response.ok) throw new Error(data?.error || "Performance data could not be loaded.");
  return data;
}

export default function PerformancePage() {
  const [data, setData] = useState<Performance | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"broilers" | "layers">("broilers");

  useEffect(() => {
    fetch("/api/performance/summary", { cache: "no-store" })
      .then(json)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load performance."));
  }, []);

  const alerts = useMemo(() => [
    ...(data?.broilers.flatMap((row) => row.signals.map((signal) => ({ flock: row.name, signal, type: "Broiler" }))) ?? []),
    ...(data?.layers.flatMap((row) => row.signals.map((signal) => ({ flock: row.name, signal, type: "Layer" }))) ?? []),
  ], [data]);

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Performance</h1><p>Actual flock performance from the records already entered in Flockence.</p></div><span className="badge">ACTUAL DATA</span></div></header>
    <Nav/>
    <main className="main">
      <section className="dashboard-head">
        <div><div className="hero-kicker">Production intelligence</div><h2>Know what is happening before it becomes a problem.</h2><p>Broilers and layers use different performance logic. Missing measurements stay visible instead of becoming invented estimates.</p></div>
        <div className="header-actions"><a className="button" href="/operations">Daily Rounds</a><a className="button button-primary" href="/reports">Reports</a></div>
      </section>

      {error && <section className="section card" role="alert"><strong>Performance data unavailable</strong><p>{error}</p></section>}

      <section className="section dashboard-grid">
        <div className="card metric-card"><div className="metric-label">Live broilers</div><div className="metric-value">{data?.farm.liveBroilers.toLocaleString() ?? "—"}</div><div className="metric-foot">{data?.farm.activeBroilerFlocks ?? "—"} active broiler flocks</div></div>
        <div className="card metric-card"><div className="metric-label">Live layer hens</div><div className="metric-value">{data?.farm.liveLayerHens.toLocaleString() ?? "—"}</div><div className="metric-foot">{data?.farm.activeLayerFlocks ?? "—"} active layer flocks</div></div>
        <div className="card metric-card"><div className="metric-label">Open signals</div><div className="metric-value">{alerts.length}</div><div className="metric-foot">calculated from actual records</div></div>
        <div className="card metric-card"><div className="metric-label">As of</div><div className="metric-value" style={{fontSize: 24}}>{data ? new Date(data.asOf).toLocaleDateString("en-BB") : "—"}</div><div className="metric-foot">seven-day layer metrics and current broiler signals</div></div>
      </section>

      <section className="section card">
        <div className="section-head">
          <div><div className="hero-kicker">Production selector</div><h3>Choose the production system</h3><p>The metrics below change with the production model. No broiler harvest assumptions are applied to layers.</p></div>
          <div className="segmented">
            <button className={view === "broilers" ? "active" : ""} onClick={() => setView("broilers")}>Broilers</button>
            <button className={view === "layers" ? "active" : ""} onClick={() => setView("layers")}>Layers</button>
          </div>
        </div>

        {view === "broilers" ? <div className="list">
          {data?.broilers.length ? data.broilers.map((row) => <article className="card" key={row.id}>
            <div className="section-head"><div><strong>{row.name}</strong><p>{row.liveBirds.toLocaleString()} live birds · {row.expectedHarvestDate ? "harvest target " + new Date(row.expectedHarvestDate).toLocaleDateString("en-BB") : "no harvest date recorded"}</p></div><span className={row.signals.length ? "badge badge-danger" : "badge"}>{row.signals.length ? row.signals.length + " SIGNALS" : "ON TRACK"}</span></div>
            <div className="stats">
              <div><span>Mortality</span><strong>{row.mortalityPercent == null ? "—" : row.mortalityPercent.toFixed(1) + "%"}</strong></div>
              <div><span>Latest live weight</span><strong>{row.latestLiveWeightKg == null ? "—" : row.latestLiveWeightKg.toFixed(2) + " kg"}</strong></div>
              <div><span>Interval FCR</span><strong>{row.intervalFcr == null ? "—" : row.intervalFcr.toFixed(2)}</strong></div>
              <div><span>Dressing yield</span><strong>{row.dressingYieldPercent == null ? "—" : row.dressingYieldPercent.toFixed(1) + "%"}</strong></div>
            </div>
            <div className="stats" style={{marginTop:10}}>
              <div><span>7-day feed</span><strong>{row.feedUsed7dKg.toFixed(1)} kg</strong></div>
              <div><span>7-day feed cost</span><strong>{money(row.feedCost7dMinor)}</strong></div>
              <div><span>Weight gap</span><strong>{row.weightGapKg == null ? "—" : (row.weightGapKg > 0 ? "+" : "") + row.weightGapKg.toFixed(2) + " kg"}</strong></div>
              <div><span>Harvest window</span><strong>{row.daysToHarvest == null ? "—" : row.daysToHarvest === 0 ? "Today" : row.daysToHarvest + " days"}</strong></div>
            </div>
            {row.signals.length > 0 && <div className="flow" style={{marginTop:12}}>{row.signals.map(signal => <span key={signal}>{signalLabel(signal)}</span>)}</div>}
          </article>) : <div className="card empty"><strong>No active broiler flock performance yet.</strong><span>Record a flock, daily checks, feed usage and live weights to activate these calculations.</span></div>}
        </div> : <div className="list">
          {data?.layers.length ? data.layers.map((row) => <article className="card" key={row.id}>
            <div className="section-head"><div><strong>{row.name}</strong><p>{row.liveHens.toLocaleString()} live hens · seven-day production view</p></div><span className={row.signals.length ? "badge badge-danger" : "badge"}>{row.signals.length ? row.signals.length + " SIGNALS" : "ON TRACK"}</span></div>
            <div className="stats">
              <div><span>Eggs collected</span><strong>{row.sevenDay.eggs.toLocaleString()}</strong></div>
              <div><span>Hen-day production</span><strong>{row.sevenDay.henDayProduction == null ? "—" : row.sevenDay.henDayProduction.toFixed(1) + "%"}</strong></div>
              <div><span>Saleable rate</span><strong>{row.sevenDay.saleableRate == null ? "—" : row.sevenDay.saleableRate.toFixed(1) + "%"}</strong></div>
              <div><span>Collection coverage</span><strong>{(row.sevenDay.collectionCoverage * 100).toFixed(0)}%</strong></div>
            </div>
            <div className="stats" style={{marginTop:10}}>
              <div><span>Feed used</span><strong>{row.sevenDay.feedKg.toFixed(1)} kg</strong></div>
              <div><span>Feed / dozen</span><strong>{row.sevenDay.feedKgPerDozen == null ? "—" : row.sevenDay.feedKgPerDozen.toFixed(2) + " kg"}</strong></div>
              <div><span>Feed cost / dozen</span><strong>{money(row.sevenDay.feedCostPerDozenMinor)}</strong></div>
              <div><span>Withdrawal holds</span><strong>{row.sevenDay.withdrawalBlockedCollections}</strong></div>
            </div>
            {row.signals.length > 0 && <div className="flow" style={{marginTop:12}}>{row.signals.map(signal => <span key={signal}>{signalLabel(signal)}</span>)}</div>}
          </article>) : <div className="card empty"><strong>No active layer flock performance yet.</strong><span>Record layer production stages and daily egg collections to activate these metrics.</span></div>}
        </div>}
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Operator alerts</div><h3>What deserves attention?</h3><p>These are prompts for investigation, not automatic diagnoses or forced decisions.</p></div><span className="badge">{alerts.length} OPEN</span></div>
        {alerts.length ? <div className="list">{alerts.slice(0, 20).map((item, index) => <div className="row" key={item.flock + "-" + item.signal + "-" + index}><div><strong>{item.flock}</strong><span>{item.type} · {signalLabel(item.signal)}</span></div><a className="button" href={item.type === "Layer" ? "/layers" : "/operations"}>Open</a></div>)}</div> : <div className="empty"><strong>No calculated warnings.</strong><span>Continue the normal daily round and keep measurements current.</span></div>}
      </section>

      <section className="section card"><h3>Data quality rule</h3><p>{data?.dataQuality.note ?? "Performance uses recorded data only."}</p></section>
    </main>
  </div>;
}
