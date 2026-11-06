"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "@/components/nav";
import { DailyFlockCheckForm } from "@/components/daily-flock-check-form";
import { FlockRecords } from "@/components/flock-records";
import { TaskPanel } from "@/components/task-panel";
import { SectionTabs } from "@/components/section-tabs";

type Batch = { id: string; name: string; initialChicks: number; status: string; productionType?: string | null; species?: string };
type Round = { date: string; coverage: { activeFlocks: number; recordedFlocks: number; missingFlocks: number }; totals: { mortalityCount: number; withdrawalHolds: number; heatWelfareFlags: number }; flocks: { id: string; name: string; checkedToday: boolean; liveCount: number | null; withdrawalHold: boolean; pantingObserved: boolean; wingSpreadingObserved: boolean }[] };
type Check = { id: string; date: string; liveCount: number; feedKg?: string | null; waterLiters?: string | null; avgWeightKg?: string | null; temperatureC?: string | null; humidityPercent?: string | null; ammoniaPpm?: string | null; litterCondition?: string | null; pantingObserved: boolean; wingSpreadingObserved: boolean; notes?: string | null; batch?: { name: string } | null };

const TABS = ["checks", "tasks", "history"] as const;
type Tab = (typeof TABS)[number];
const list = async (url: string) => { const r = await fetch(url, { cache: "no-store" }); const d = await r.json(); if (!r.ok || !Array.isArray(d)) throw new Error("Could not load " + url); return d; };
const fixed = (value?: string | null, unit = "") => value == null || value === "" ? "–" : `${Number(value)}${unit}`;

function DailyRound() {
  const params = useSearchParams();
  const asked = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as Tab) : "checks";
  const [batches, setBatches] = useState<Batch[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<Check[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([list("/api/batches"), fetch("/api/daily-round", { cache: "no-store" }).then(r => r.ok ? r.json() : null), list("/api/daily-flock-check")])
      .then(([b, r, h]) => { setBatches(b); setRound(r); setHistory(h); setError(""); })
      .catch(() => setError("Could not load today's round. Check your connection and reload."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const missing = round?.flocks.filter(flock => !flock.checkedToday) ?? [];
  const tabs = [
    { id: "checks", label: "Today's checks", href: "/daily-round", count: round?.coverage.missingFlocks },
    { id: "tasks", label: "Tasks", href: "/daily-round?tab=tasks" },
    { id: "history", label: "History", href: "/daily-round?tab=history" },
  ];

  return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Daily round</h1><p>Check each flock, record what you find, and see what is still outstanding today.</p></div></div></header><Nav /><main className="main">
    {error && <section className="section card" role="alert"><strong>{error}</strong></section>}
    {round && <section className="section card" aria-label="Today's progress">
      <div className="section-head"><div><h3>Today · {round.date}</h3><p>{round.coverage.activeFlocks === 0 ? "No active flocks yet. Start one under Production › Flocks." : round.coverage.missingFlocks === 0 ? "Every active flock has been checked today." : `${round.coverage.recordedFlocks} of ${round.coverage.activeFlocks} flocks checked.`}</p></div><span className="badge">{round.coverage.recordedFlocks}/{round.coverage.activeFlocks} CHECKED</span></div>
      {missing.length > 0 && <p><strong>Still to check:</strong> {missing.map(flock => flock.name).join(", ")}</p>}
      <p className="muted">Deaths recorded today: {round.totals.mortalityCount}{round.totals.heatWelfareFlags > 0 ? ` · Heat-stress signs noted in ${round.totals.heatWelfareFlags} flock(s)` : ""}{round.totals.withdrawalHolds > 0 ? ` · ${round.totals.withdrawalHolds} treatment withdrawal hold(s) active` : ""}</p>
    </section>}
    <SectionTabs tabs={tabs} current={tab} label="Daily round sections" />
    {tab === "checks" && <>
      <DailyFlockCheckForm batches={batches} />
      <FlockRecords batches={batches} onSaved={load} />
      <section className="section card"><h3>Not part of the daily round</h3><p className="muted">Slaughter and processing are under <Link href="/harvest">Harvest &amp; Processing</Link>, journeys under <Link href="/transport">Transport</Link>, and the biosecurity checklist under <Link href="/food-safety">Food Safety</Link>.</p></section>
    </>}
    {tab === "tasks" && <section className="section"><TaskPanel batches={batches.map(b => ({ id: b.id, name: b.name }))} /></section>}
    {tab === "history" && <section className="section"><div className="section-head"><div><h2>Recent checks</h2><p>The latest 100 daily checks across all flocks.</p></div></div>
      {history.length === 0 ? <div className="card"><p className="muted">No daily checks recorded yet. Saved checks appear here.</p></div> :
        <div className="card table-wrap"><table><thead><tr><th>Date</th><th>Flock</th><th>Live birds</th><th>Feed kg</th><th>Water L</th><th>Weight kg</th><th>Temp</th><th>Humidity</th><th>Litter</th><th>Notes</th></tr></thead>
          <tbody>{history.map(row => <tr key={row.id}><td>{row.date.slice(0, 10)}</td><td>{row.batch?.name ?? "–"}</td><td>{row.liveCount}</td><td>{fixed(row.feedKg)}</td><td>{fixed(row.waterLiters)}</td><td>{fixed(row.avgWeightKg)}</td><td>{fixed(row.temperatureC, " °C")}</td><td>{fixed(row.humidityPercent, " %")}</td><td>{row.litterCondition ?? "–"}{row.pantingObserved || row.wingSpreadingObserved ? " · heat signs" : ""}</td><td>{row.notes ?? ""}</td></tr>)}</tbody></table></div>}
    </section>}
  </main></div>;
}

export default function DailyRoundPage() { return <Suspense fallback={null}><DailyRound /></Suspense>; }
