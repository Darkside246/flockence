"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardNumbers = { liveBroilerBirds: number; liveLayerBirds: number; activeBroilerFlocks: number; activeLayerFlocks: number; mortalityCount: number } | null;
type RoundFlock = { productionType: string | null; species: string; checkedToday: boolean; liveCount: number | null; feedKg: number | null; waterLiters: number | null; avgWeightKg: number | null; withdrawalHold: boolean };
type LifecycleRow = { batch: { productionType?: string | null; species?: string }; lifecycle: { weightReady: boolean; ageDays: number }; withdrawalBlocked: boolean };
type LayerPerformance = { window: { days: number }; coverage: { layingFlocks: number }; summary: { eggsCollectedOnCompleteDays: number; saleableEggsOnCompleteDays: number; henDayProduction: number | null; saleableRate: number | null; feedKgPerDozenSaleableEggs: number | null } };

const isLayer = (f: { productionType?: string | null; species?: string }) =>
  f.productionType === "LAYER" || (f.productionType == null && (f.species ?? "").toUpperCase() === "LAYER");

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <div className="cx-stat"><div className="cx-label">{label}</div><div className="cx-num cx-stat-value">{value}</div><div className="cx-na">{foot}</div></div>;
}

const num = (n: number | null | undefined, digits = 0) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));

/** Separate broiler and layer summaries. Every figure is recorded data; missing values show a dash and a reason. */
export function ProductionPanels({ data, flocks, lifecycle }: { data: DashboardNumbers; flocks: RoundFlock[]; lifecycle: LifecycleRow[] }) {
  const [layer, setLayer] = useState<LayerPerformance | null>(null);
  useEffect(() => { fetch("/api/layers/performance").then((r) => (r.ok ? r.json() : null)).then(setLayer).catch(() => setLayer(null)); }, []);

  const broilerFlocks = flocks.filter((f) => !isLayer(f));
  const broilerChecked = broilerFlocks.filter((f) => f.checkedToday);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const weights = broilerChecked.map((f) => f.avgWeightKg).filter((w): w is number => w != null);
  const avgWeight = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  const broilerRows = lifecycle.filter((r) => !isLayer(r.batch));
  const ready = broilerRows.filter((r) => r.lifecycle.weightReady).length;
  const holds = broilerRows.filter((r) => r.withdrawalBlocked).length;
  const hasBroilers = (data?.activeBroilerFlocks ?? 0) > 0;
  const hasLayers = (data?.activeLayerFlocks ?? 0) > 0;
  const s = layer?.summary;

  return <div className="cx-prod">
    <div className="card cx-prod-card">
      <div className="section-head"><div><div className="hero-kicker">Broiler production</div><h3>Meat flocks</h3></div><Link className="button" href="/batches">Flocks →</Link></div>
      {!hasBroilers && <div className="cx-empty"><strong>No active broiler flocks</strong>Start a batch to see growth, feed and harvest readiness here.</div>}
      <div className="cx-prod-stats">
        <Stat label="Live birds" value={num(data?.liveBroilerBirds)} foot={`${data?.activeBroilerFlocks ?? 0} flock(s) active`} />
        <Stat label="Avg weight" value={avgWeight == null ? "—" : `${avgWeight.toFixed(2)} kg`} foot={avgWeight == null ? "No weight in today's checks" : "From today's checks"} />
        <Stat label="Feed today" value={broilerChecked.length ? `${sum(broilerChecked.map((f) => f.feedKg)).toFixed(1)} kg` : "—"} foot={broilerChecked.length ? `${broilerChecked.length} flock(s) checked` : "No check recorded"} />
        <Stat label="Water today" value={broilerChecked.length ? `${sum(broilerChecked.map((f) => f.waterLiters)).toFixed(1)} L` : "—"} foot={broilerChecked.length ? "Recorded in checks" : "No check recorded"} />
        <Stat label="Harvest ready" value={hasBroilers ? String(ready) : "—"} foot={hasBroilers ? "Flock(s) at target weight" : "No flocks"} />
        <Stat label="Withdrawal holds" value={hasBroilers ? String(holds) : "—"} foot={hasBroilers ? (holds ? "Not saleable yet" : "None active") : "No flocks"} />
      </div>
    </div>

    <div className="card cx-prod-card">
      <div className="section-head"><div><div className="hero-kicker">Layer production</div><h3>Egg flocks</h3></div><Link className="button" href="/layers">Eggs →</Link></div>
      {!hasLayers && <div className="cx-empty"><strong>No active layer flocks</strong>Add a layer flock and record daily collections to see egg production here.</div>}
      <div className="cx-prod-stats">
        <Stat label="Live hens" value={num(data?.liveLayerBirds)} foot={`${data?.activeLayerFlocks ?? 0} flock(s) active`} />
        <Stat label="Eggs collected" value={s && s.eggsCollectedOnCompleteDays > 0 ? num(s.eggsCollectedOnCompleteDays) : "—"} foot={`Last ${layer?.window.days ?? 30} days, complete days only`} />
        <Stat label="Hen-day rate" value={s?.henDayProduction == null ? "—" : `${s.henDayProduction.toFixed(1)}%`} foot={s?.henDayProduction == null ? "Needs complete daily records" : "Eggs per hen per day"} />
        <Stat label="Saleable rate" value={s?.saleableRate == null ? "—" : `${s.saleableRate.toFixed(1)}%`} foot={s?.saleableRate == null ? "No graded eggs yet" : "Of eggs collected"} />
        <Stat label="Saleable eggs" value={s && s.saleableEggsOnCompleteDays > 0 ? num(s.saleableEggsOnCompleteDays) : "—"} foot="After withdrawal and grading" />
        <Stat label="Feed / dozen" value={s?.feedKgPerDozenSaleableEggs == null ? "—" : `${s.feedKgPerDozenSaleableEggs.toFixed(2)} kg`} foot="Recorded feed per saleable dozen" />
      </div>
    </div>
  </div>;
}
