"use client";

import { useEffect, useState } from "react";
import { VisionDailyReport } from "@/components/vision-daily-report";
import { VisionAlerts } from "@/components/vision-alerts";

type Report = {
  scope: { label: string }; period: { label: string };
  overall: { status: string; label: string }; summary: string;
  areas: { area: string; label: string; status: string; statusLabel: string; reasons: string[]; fixed: number }[];
  actions: { kind: string; severity: string; finding: string; action: string }[];
  population: { liveRecorded: number | null; mostVisible: number | null; note: string };
  flocks: { id: string; name: string; kind: string; ageDays: number; placed: number; liveRecorded: number | null; deathsInPeriod: number; feedKgInPeriod: number; eggsInPeriod: number | null; floorEggsInPeriod: number | null }[];
  coverage: { inspections: number; hoursCovered: number; hoursInPeriod: number; sources: { name: string; inspections: number; videoSamples: number; lastAt: string }[]; silentCameras: string[]; dayParts: Record<string, number> };
  changes: { area: string; label: string; now: number; before: number; trend: string }[];
  evidence: { title: string; at: string; url: string | null }[];
  limitations: string[];
  eggs: { recordedEggs: number; recordedFloorEggs: number; picturesChecked: number; picturesWithFloorEggs: number; mostFloorEggsInOnePicture: number | null; countsOn: boolean; note: string } | null;
};
type Option = { id: string; name: string };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const tone = (status: string) => ({ URGENT: "urgent", ATTENTION: "attention", MONITOR: "monitor", GOOD: "good" } as Record<string, string>)[status] ?? "unknown";

/**
 * The Vision view in the Camera tab (Vision Intelligence phase 1b): choose the whole farm, a pen, a batch or a camera
 * and a period, and read what Vision found, built from the inspections, findings and farm records already saved.
 * Opening a report runs no new picture analysis, so it costs nothing.
 */
/** Show Vision's egg counts from pictures, once the farm has compared them with its collections (owners, managers). */
function EggCountsSwitch({ on }: { on: boolean }) {
  const [value, setValue] = useState(on);
  const [note, setNote] = useState("");
  return <label className="vision-egg-switch"><input type="checkbox" checked={value} onChange={async (e) => {
    const next = e.target.checked;
    setNote("");
    const r = await fetch("/api/vision/eggs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ counts: next }) }).catch(() => null);
    if (r?.ok) { setValue(next); setNote("Saved. New checks and reports use this."); } else setNote(r?.status === 403 ? "Only owners and managers can change this." : "Could not save.");
  }} /> Show egg counts from pictures (switch on after comparing a few days of Vision's counts with your collections){note && <small className="muted"> {note}</small>}</label>;
}

export function VisionIntelligence({ cameras, onVisionPage = false }: { cameras: { name: string }[]; onVisionPage?: boolean }) {
  const [pens, setPens] = useState<Option[]>([]);
  const [batches, setBatches] = useState<Option[]>([]);
  const [scope, setScope] = useState("farm");
  const [target, setTarget] = useState("");
  const [period, setPeriod] = useState("7d");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/vision/pens", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(d => setPens(Array.isArray(d) ? d : d?.pens ?? [])).catch(() => {});
    fetch("/api/batches", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(d => setBatches(Array.isArray(d) ? d.map((b: { id: string; name: string; status: string }) => ({ id: b.id, name: b.name + (b.status === "ACTIVE" ? "" : " (closed)") })) : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (scope !== "farm" && !target) { setReport(null); return; }
    if (period === "custom" && (!from || !to)) return;
    const q = new URLSearchParams({ scope, period });
    if (scope === "camera") q.set("camera", target); else if (scope !== "farm") q.set("id", target);
    if (period === "custom") { q.set("from", from); q.set("to", to); }
    setLoading(true); setError("");
    fetch("/api/vision/report?" + q, { cache: "no-store" }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not build the report.");
      setReport(d.report);
    }).catch(e => { setReport(null); setError(e instanceof Error ? e.message : "Could not build the report."); }).finally(() => setLoading(false));
  }, [scope, target, period, from, to]);

  const options = scope === "pen" ? pens : scope === "batch" ? batches : scope === "camera" ? cameras.map(c => ({ id: c.name, name: c.name })) : [];

  return <div className="vision-intel">
    <div className="card vision-intel-controls">
      <label>Report on<select value={scope} onChange={e => { setScope(e.target.value); setTarget(""); if (e.target.value !== "batch" && period === "batch") setPeriod("7d"); }}>
        <option value="farm">Whole farm</option><option value="pen">One pen</option><option value="batch">One batch</option>{cameras.length > 0 && <option value="camera">One camera</option>}
      </select></label>
      {scope !== "farm" && <label>{scope === "pen" ? "Pen" : scope === "batch" ? "Batch" : "Camera"}<select value={target} onChange={e => setTarget(e.target.value)}>
        <option value="">Choose…</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select></label>}
      <label>Period<select value={period} onChange={e => setPeriod(e.target.value)}>
        <option value="today">Today</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
        {scope === "batch" && <option value="batch">The whole batch</option>}<option value="custom">Choose dates</option>
      </select></label>
      {period === "custom" && <><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}
      {!onVisionPage && <a className="button" href="/vision">Run a check or review findings</a>}
    </div>
    <VisionAlerts />
    <VisionDailyReport />

    {error && <p role="alert" className="notice">{error}</p>}
    {loading && <p>Building the report…</p>}
    {report && !loading && <>
      <section className={"card vision-intel-overall is-" + tone(report.overall.status)}>
        <div className="hero-kicker">{report.scope.label} · {report.period.label}</div>
        <h3>{report.overall.label}</h3>
        <p>{report.summary}</p>
      </section>

      <div className="vision-intel-areas">{report.areas.map(a => <article key={a.area} className={"card vision-intel-area is-" + tone(a.status)}>
        <span className="vision-intel-area-status">{a.statusLabel}</span>
        <strong>{a.label}</strong>
        {a.reasons.length ? <ul>{a.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="muted">{a.status === "INSUFFICIENT_DATA" ? "Not seen in this period." : "Nothing found in what was seen."}</p>}
        {a.fixed > 0 && <small className="muted">{a.fixed} marked fixed</small>}
      </article>)}</div>

      {report.actions.length > 0 && <section className="card"><h3>What to do, most important first</h3><ol className="vision-intel-actions">
        {report.actions.map(a => <li key={a.kind}><strong>{a.finding}.</strong> {a.action}</li>)}
      </ol></section>}

      <section className="card"><h3>Birds and records</h3>
        <p>{report.population.liveRecorded != null ? `Live birds in your records: ${report.population.liveRecorded.toLocaleString()}.` : "No live count from your records for this scope."} {report.population.mostVisible != null ? `Most birds seen in one picture: about ${report.population.mostVisible}.` : ""}</p>
        <p className="muted">{report.population.note}</p>
        {report.flocks.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Flock</th><th>Age</th><th>Placed</th><th>Live (records)</th><th>Deaths in period</th><th>Feed in period</th>{report.flocks.some(f => f.eggsInPeriod != null) && <th>Eggs (floor)</th>}</tr></thead>
          <tbody>{report.flocks.map(f => <tr key={f.id}><td>{f.name} ({f.kind})</td><td>{f.ageDays} days</td><td>{f.placed.toLocaleString()}</td><td>{f.liveRecorded?.toLocaleString() ?? "—"}</td><td>{f.deathsInPeriod}</td><td>{f.feedKgInPeriod} kg</td>{report.flocks.some(x => x.eggsInPeriod != null) && <td>{f.eggsInPeriod != null ? `${f.eggsInPeriod} (${f.floorEggsInPeriod})` : "—"}</td>}</tr>)}</tbody></table></div>}
      </section>

      {report.eggs && <section className="card"><h3>Eggs (layers)</h3>
        <ul>
          <li><strong>Your records:</strong> {report.eggs.recordedEggs.toLocaleString()} eggs collected, {report.eggs.recordedFloorEggs.toLocaleString()} of them floor eggs.</li>
          <li><strong>Vision:</strong> {report.eggs.picturesChecked ? `floor eggs seen in ${report.eggs.picturesWithFloorEggs} of ${report.eggs.picturesChecked} pictures of the layer house${report.eggs.mostFloorEggsInOnePicture != null ? `, at most about ${report.eggs.mostFloorEggsInOnePicture} in one picture` : ""}.` : "no pictures of the layer house in this period."}</li>
        </ul>
        <p className="muted">{report.eggs.note}</p>
        <EggCountsSwitch on={report.eggs.countsOn} />
      </section>}

      {report.changes.length > 0 && <section className="card"><h3>Compared with the period before</h3><ul>
        {report.changes.map(c => <li key={c.area}>{c.label}: {c.now} finding{c.now === 1 ? "" : "s"} (before: {c.before}){c.trend === "worse" ? ", worse" : c.trend === "better" ? ", better" : ""}</li>)}
      </ul></section>}

      <section className="card"><h3>What this report is based on</h3>
        <p>{report.coverage.inspections} inspection{report.coverage.inspections === 1 ? "" : "s"}, with pictures in {report.coverage.hoursCovered} of {report.coverage.hoursInPeriod} hours.
          {" "}By time of day: {Object.entries(report.coverage.dayParts).map(([k, v]) => `${k} ${v}`).join(", ")}.</p>
        {report.coverage.sources.length > 0 && <ul>{report.coverage.sources.map(s => <li key={s.name}>{s.name}: {s.inspections} inspection{s.inspections === 1 ? "" : "s"}{s.videoSamples ? ` (${s.videoSamples} short video samples)` : ""}, last {when(s.lastAt)}</li>)}</ul>}
        {report.coverage.silentCameras.length > 0 && <p className="notice">No pictures from: {report.coverage.silentCameras.join(", ")}.</p>}
      </section>

      {report.evidence.length > 0 && <section className="card"><h3>Evidence</h3><ul>
        {report.evidence.map((e, i) => <li key={i}>{e.title}, {when(e.at)}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer">picture</a></>}</li>)}
      </ul></section>}

      <section className="card"><h3>Limits of this report</h3><ul>{report.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></section>
    </>}
  </div>;
}
