"use client";

import { useEffect, useState } from "react";

type Finding = {
  id: string; kind: string; title: string; detail: string | null; severity: string; state: string; confidence: string | null;
  penName: string | null; cameraName: string | null; firstSeenAt: string; lastSeenAt: string; occurrences: number; evidenceUrl: string | null;
};
type Entry = { at: string; kind: "inspection" | "finding" | "review"; text: string; severity?: string; imageUrl?: string | null };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const severityLabel: Record<string, string> = { CRITICAL: "Urgent", HIGH: "High", MEDIUM: "Check soon", INFO: "Note" };
const stateLabel: Record<string, string> = {
  OBSERVED: "Seen", SUSPECTED: "Suspected", REQUIRES_INSPECTION: "Needs a look", INCONCLUSIVE: "Unclear",
  CONFIRMED: "Confirmed", DISMISSED: "Not a problem", RESOLVED: "Fixed",
};

/**
 * Things Vision saw that a person should check (Vision Intelligence phase 1). Each one can be confirmed, marked not a
 * problem, or marked fixed; the farm's official records are never changed by Vision. Below, a pen's history over time.
 */
export function VisionFindings({ pens, canReview }: { pens: { id: string; name: string }[]; canReview: boolean }) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [message, setMessage] = useState("");
  const [penId, setPenId] = useState("");
  const [days, setDays] = useState(30);
  const [timeline, setTimeline] = useState<Entry[] | null>(null);
  const load = () => fetch("/api/vision/findings", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => setFindings(d?.findings ?? [])).catch(() => setFindings([]));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!penId) { setTimeline(null); return; }
    fetch(`/api/vision/timeline?penId=${encodeURIComponent(penId)}&days=${days}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => setTimeline(d?.entries ?? [])).catch(() => setTimeline([]));
  }, [penId, days]);

  async function review(f: Finding, state: "CONFIRMED" | "DISMISSED" | "RESOLVED") {
    const note = state === "DISMISSED" ? (window.prompt("Why is this not a problem? (optional)") ?? "") : "";
    const r = await fetch("/api/vision/findings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, state, note }) });
    const d = await r.json().catch(() => ({}));
    setMessage(r.ok ? `Saved: "${f.title}" is now ${stateLabel[state].toLowerCase()}.${state === "CONFIRMED" && f.kind === "DEAD_OR_DOWN_BIRD" ? " If a bird died, record it under Daily Rounds; Vision does not change the bird count." : ""}` : d.error || "Could not save.");
    if (r.ok) { void load(); if (penId) setPenId(p => p); }
  }

  return <section className="section card vision-findings" aria-labelledby="vision-findings-title">
    <div className="section-head"><div><div className="hero-kicker">To check</div><h3 id="vision-findings-title">What Vision found</h3>
      <p>Things a person should look at, most recent first. Repeat sightings in the same pen are grouped. Vision never changes your bird count, deaths, feed, water or eggs.</p></div></div>
    {message && <p role="status" className="notice">{message}</p>}
    {findings === null ? <p>Loading…</p> : findings.length === 0 ? <p className="muted">Nothing open to check. This only covers what the cameras and photos showed, not the whole farm.</p> :
      <ul className="finding-list">{findings.map(f => <li key={f.id} className={"finding finding-" + f.severity.toLowerCase()}>
        <div className="finding-head">
          <span className="finding-severity">{severityLabel[f.severity] ?? f.severity}</span>
          <strong>{f.title}</strong>
          <span className="finding-state">{stateLabel[f.state] ?? f.state}</span>
        </div>
        <p className="finding-where">{[f.penName && `Pen ${f.penName}`, f.cameraName && `Camera ${f.cameraName}`, `seen ${when(f.lastSeenAt)}`, f.occurrences > 1 && `${f.occurrences} times since ${when(f.firstSeenAt)}`, f.confidence && `model confidence ${f.confidence.toLowerCase()}`].filter(Boolean).join(" · ")}</p>
        {f.detail && <p className="finding-detail">{f.detail}</p>}
        <div className="finding-actions">
          {f.evidenceUrl && <a className="button" href={f.evidenceUrl} target="_blank" rel="noreferrer">See the picture</a>}
          {canReview && <>
            <button type="button" className="button" onClick={() => void review(f, "CONFIRMED")}>Confirmed</button>
            <button type="button" className="button" onClick={() => void review(f, "DISMISSED")}>Not a problem</button>
            <button type="button" className="button" onClick={() => void review(f, "RESOLVED")}>Fixed</button>
          </>}
        </div>
      </li>)}</ul>}

    {pens.length > 0 && <div className="pen-timeline">
      <h4>Pen history</h4>
      <div className="pen-timeline-controls">
        <label>Pen<select value={penId} onChange={e => setPenId(e.target.value)}><option value="">Choose a pen</option>{pens.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Period<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={400}>Everything</option></select></label>
      </div>
      {penId && (timeline === null ? <p>Loading…</p> : timeline.length === 0 ? <p className="muted">No Vision history for this pen in this period.</p> :
        <ol className="case-timeline">{timeline.map((e, i) => <li key={i}>
          <span className="tl-kind">{e.kind === "inspection" ? "Inspection" : e.kind === "finding" ? (severityLabel[e.severity ?? ""] ?? "Finding") : "Checked by a person"}</span>
          <time>{when(e.at)}</time>
          <p>{e.text}{e.imageUrl && <> · <a href={e.imageUrl} target="_blank" rel="noreferrer">picture</a></>}</p>
        </li>)}</ol>)}
    </div>}
  </section>;
}
