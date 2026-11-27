"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";
import { VisionReport } from "@/components/vision-report";
import { VisionGlance, birdsOf, sourceLabel, type SavedInspection } from "@/components/vision-glance";

const STATUS: Record<string, string> = { GOOD: "Looks good", ATTENTION: "Needs attention", WARNING: "Needs attention", CRITICAL: "Urgent", INSUFFICIENT_EVIDENCE: "Not enough seen" };

/**
 * Farm Vision reports, like a file explorer: the list on the left (when, where, status, birds), filtered by camera or
 * pen and status; the chosen report on the right (picture, at a glance, the full report, the real-count box). On a
 * phone the list comes first and the report opens below it. The link /vision/reports?id=… opens one report.
 */
export default function VisionReportsPage() {
  const [items, setItems] = useState<SavedInspection[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [where, setWhere] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelected(id);
    fetch("/api/vision", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 401 ? "Sign in to see reports." : "Reports could not be loaded.");
      const rows = await r.json() as SavedInspection[];
      setItems(rows);
      if (!id && rows[0] && window.matchMedia("(min-width: 900px)").matches) setSelected(rows[0].id);
    }).catch((e) => setError(e instanceof Error ? e.message : "Reports could not be loaded."));
  }, []);

  const places = useMemo(() => [...new Set((items ?? []).map(sourceLabel))].sort(), [items]);
  const shown = (items ?? []).filter((i) => (!where || sourceLabel(i) === where) && (!status || (i.visionAssessment?.status ?? "INSUFFICIENT_EVIDENCE") === status));
  const current = (items ?? []).find((i) => i.id === selected) ?? null;

  function open(id: string) {
    setSelected(id);
    window.history.replaceState(null, "", `/vision/reports?id=${encodeURIComponent(id)}`);
    if (!window.matchMedia("(min-width: 900px)").matches) setTimeout(() => document.getElementById("report-detail")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Vision reports</h1><p>Every check, quick to scan; open one for the full report.</p></div></div></header>
    <Nav />
    <main className="main">
      <p><a href="/vision">← Back to Farm Vision</a></p>
      {error && <p role="alert" className="notice">{error}</p>}
      {!items && !error && <p>Loading reports…</p>}
      {items && <div className="vision-explorer">
        <section className="vision-explorer-list card" aria-label="Reports">
          <div className="vision-explorer-filters">
            <label>Camera or pen<select value={where} onChange={(e) => setWhere(e.target.value)}><option value="">All</option>{places.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(STATUS).filter(([k]) => k !== "WARNING").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          {shown.length === 0 ? <p className="muted">No reports match.</p> : <ul role="listbox" aria-label="Reports">
            {shown.map((i) => {
              const b = birdsOf(i);
              const s = i.visionAssessment?.status ?? "INSUFFICIENT_EVIDENCE";
              return <li key={i.id} role="option" aria-selected={i.id === selected}>
                <button type="button" className={i.id === selected ? "is-selected" : ""} onClick={() => open(i.id)}>
                  {i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <span className="vision-explorer-noimg" aria-hidden="true" />}
                  <span className="vision-explorer-meta">
                    <strong>{new Date(i.observedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
                    <span>{sourceLabel(i)}</span>
                    <span className={`vision-glance-status is-${s.toLowerCase()}`}>{STATUS[s] ?? s}</span>
                    {b.visible != null && <span className="muted">{b.estimate ? `~${b.estimate.estimate} in pen` : `~${b.visible} in view`}</span>}
                  </span>
                </button>
              </li>;
            })}
          </ul>}
        </section>
        <section id="report-detail" className="vision-explorer-detail card" aria-live="polite">
          {!current ? <p className="muted">Choose a report from the list.</p> : <>
            {current.imageUrl && <a href={current.imageUrl} target="_blank" rel="noreferrer"><img className="vision-explorer-photo" src={current.imageUrl} alt="The picture checked" /></a>}
            <VisionGlance key={current.id} item={current} showFullLink={false} />
            <details className="vision-explorer-full"><summary><strong>Full report</strong></summary>{current.notes ? <VisionReport text={current.notes} /> : <p>No notes recorded.</p>}</details>
          </>}
        </section>
      </div>}
    </main>
  </div>;
}
