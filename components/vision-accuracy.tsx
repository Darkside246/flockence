"use client";

import { useCallback, useEffect, useState } from "react";

type Label = { birds: number | null; deadOrDown: number | null; floorEggs: number | null };
type Row = { id: string; observedAt: string; imageUrl: string | null; camera: string | null; pen: string | null;
  said: { birds: number | null; stillBirds: number; detector: number | null; floorEggs: number | null }; label: Label | null };
type CountError = { checks: number; meanMiss: number; meanMissPercent: number | null; within10Percent: number | null } | null;
type Report = {
  labelled: number; checks: number; dependable: boolean;
  birdCount: { model: CountError; counter: CountError };
  deadBirds: { checks: number; found: number; missed: number; falseAlarms: number; quiet: number; foundPercent: number | null; falseAlarmPercent: number | null };
  floorEggs: CountError;
  reviewedFindings: { confirmed: number; dismissed: number; rightPercent: number | null };
};

const endpoint = "/api/vision/accuracy";
const show = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);

function CountLine({ title, value }: { title: string; value: CountError }) {
  return <div className="card metric-card"><div className="metric-label">{title}</div>
    <div className="metric-value">{value ? `±${value.meanMiss}` : "—"}</div>
    <div className="metric-foot">{value ? `birds off on average · ${show(value.meanMissPercent, "%")} · ${show(value.within10Percent, "%")} within 10% · ${value.checks} checks` : "No labelled checks yet"}</div></div>;
}

/**
 * Farm Vision → Accuracy: label recent checks with what was really in the picture, and see how close Farm Vision was.
 * Supervisors and owners only. Labels never change farm records.
 */
export function VisionAccuracy() {
  const [rows, setRows] = useState<Row[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Record<keyof Label, string>>>({});
  const [saving, setSaving] = useState("");
  const [onlyUnlabelled, setOnlyUnlabelled] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the checks.");
      setRows(data.rows); setReport(data.report); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the checks."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const draftFor = (row: Row) => drafts[row.id] ?? {
    birds: row.label?.birds?.toString() ?? "", deadOrDown: row.label?.deadOrDown?.toString() ?? "", floorEggs: row.label?.floorEggs?.toString() ?? "",
  };
  const setField = (row: Row, field: keyof Label, value: string) => setDrafts((d) => ({ ...d, [row.id]: { ...draftFor(row), [field]: value } }));

  async function save(row: Row) {
    setSaving(row.id); setError("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observationId: row.id, ...draftFor(row) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the label.");
      setDrafts((d) => { const next = { ...d }; delete next[row.id]; return next; });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the label."); }
    finally { setSaving(""); }
  }

  const visible = rows.filter((r) => !onlyUnlabelled || !r.label).slice(0, 40);
  const r = report;
  return <section className="section card">
    <div className="section-head"><div><div className="hero-kicker">Measured accuracy</div><h3>How close Farm Vision has been</h3>
      <p>Label a few checks a day with what was really in the picture. Farm Vision is then measured against your eyes instead of its own confidence. Labels never change flock records.</p></div>
      <a className="button" href={endpoint + "?format=csv"} download>Download labelled checks (CSV)</a></div>
    {error && <p role="alert">{error}</p>}

    {r && <>
      <p role="status">{r.labelled} of {r.checks} checks from the last 60 days labelled.{!r.dependable && ` Label at least 20 for a dependable figure.`}</p>
      <div className="dashboard-grid">
        <CountLine title="Birds in view (Farm Vision)" value={r.birdCount.model} />
        <CountLine title="Birds in view (bird counter)" value={r.birdCount.counter} />
        <div className="card metric-card"><div className="metric-label">Dead or down birds found</div>
          <div className="metric-value">{show(r.deadBirds.foundPercent, "%")}</div>
          <div className="metric-foot">{r.deadBirds.found} found, {r.deadBirds.missed} missed · {show(r.deadBirds.falseAlarmPercent, "%")} false alarms on {r.deadBirds.falseAlarms + r.deadBirds.quiet} clear checks</div></div>
        <div className="card metric-card"><div className="metric-label">Dead-bird alerts you reviewed</div>
          <div className="metric-value">{show(r.reviewedFindings.rightPercent, "%")}</div>
          <div className="metric-foot">{r.reviewedFindings.confirmed} real, {r.reviewedFindings.dismissed} dismissed</div></div>
      </div>
      {r.floorEggs && <p>Floor eggs: off by {r.floorEggs.meanMiss} on average over {r.floorEggs.checks} labelled checks.</p>}
    </>}

    <label><input type="checkbox" checked={onlyUnlabelled} onChange={(e) => setOnlyUnlabelled(e.target.checked)} /> Show only checks not labelled yet</label>
    {!visible.length ? <div className="empty">{rows.length ? "Every recent check is labelled." : "No Farm Vision checks with a picture in the last 60 days."}</div> : <div className="list">
      {visible.map((row) => { const d = draftFor(row); return <article className="card" key={row.id}>
        <div className="grid2" style={{ alignItems: "start" }}>
          {row.imageUrl && <a href={row.imageUrl} target="_blank" rel="noopener noreferrer"><img src={row.imageUrl} alt={`Farm Vision picture${row.camera ? " from " + row.camera : ""}, ${new Date(row.observedAt).toLocaleString()}`} loading="lazy" style={{ width: "100%", borderRadius: 8 }} /></a>}
          <form className="form" onSubmit={(e) => { e.preventDefault(); void save(row); }}>
            <strong>{new Date(row.observedAt).toLocaleString()}</strong>
            <span className="muted">{[row.camera, row.pen].filter(Boolean).join(" · ") || "Uploaded photo"}</span>
            <span>Farm Vision said: {show(row.said.birds)} birds in view{row.said.detector !== null ? ` (counter ${row.said.detector})` : ""}, {row.said.stillBirds} lying still{row.said.floorEggs !== null ? `, ${row.said.floorEggs} floor eggs` : ""}.</span>
            <label>Birds really in view<input inputMode="numeric" pattern="[0-9]*" value={d.birds} onChange={(e) => setField(row, "birds", e.target.value)} /></label>
            <label>Dead or down birds in view<input inputMode="numeric" pattern="[0-9]*" value={d.deadOrDown} onChange={(e) => setField(row, "deadOrDown", e.target.value)} /></label>
            <label>Floor eggs in view (layers)<input inputMode="numeric" pattern="[0-9]*" value={d.floorEggs} onChange={(e) => setField(row, "floorEggs", e.target.value)} /></label>
            <button className="button button-primary" type="submit" disabled={saving === row.id}>{saving === row.id ? "Saving…" : row.label ? "Update label" : "Save label"}</button>
          </form>
        </div>
      </article>; })}
    </div>}
  </section>;
}
