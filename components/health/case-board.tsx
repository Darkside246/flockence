"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { attention, OUTCOMES, type CaseAction } from "@/lib/health-case-lifecycle";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type CaseEvent = { id: string; type: string; fromStatus?: string | null; toStatus?: string | null; note?: string | null; createdAt: string };
type HealthCaseRow = {
  id: string; caseNumber: string; title: string; summary?: string | null; status: "OPEN" | "MONITORING" | "RESOLVED" | "CLOSED"; severity: string; confidence: string;
  affectedCount: number; deathsCount: number; openedAt: string; closedAt?: string | null; resolvedAt?: string | null; outcome?: string | null; nextReviewAt?: string | null;
  reopenedCount?: number; lastActivityAt?: string | null; notifiable?: boolean; reportedToAuthorityAt?: string | null; authorityReference?: string | null;
  suspectedCause?: string | null; confirmedDiagnosis?: string | null; isolationRecommended: boolean; movementRestricted: boolean;
  batch?: { name: string } | null; events?: CaseEvent[];
  observations?: { id: string; observedAt: string; symptom: string; notes?: string | null; affectedCount: number }[];
  treatments?: { id: string; productName: string; startedAt: string; status: string; withdrawalClearsAt?: string | null }[];
  diagnosticTests?: { id: string; testName: string; testDate: string; status: string; resultSummary?: string | null }[];
};

const FILTERS = [["active", "Active"], ["resolved", "Resolved"], ["closed", "Closed"], ["all", "All"]] as const;
type Filter = (typeof FILTERS)[number][0];
const STATUS_LABEL: Record<string, string> = { OPEN: "Open", MONITORING: "Monitoring", RESOLVED: "Resolved", CLOSED: "Closed" };
const day = (value?: string | null) => (value ? value.slice(0, 10) : "");
const stamp = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
const plusDays = (from: string, n: number) => new Date(Date.parse(from + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

const ACTION_TITLE: Record<CaseAction, string> = {
  note: "Add an update", monitor: "Start monitoring", escalate: "Get worse: back to open", resolve: "Resolve the case", close: "Close the case", reopen: "Reopen the case", report: "Record a report to Veterinary Services",
};

export function CaseBoard({ cases, canDecide, canWrite, onChanged, onNew }: { cases: HealthCaseRow[]; canDecide: boolean; canWrite: boolean; onChanged: () => void; onNew: () => void }) {
  const [filter, setFilter] = useState<Filter>("active");
  const [acting, setActing] = useState<{ row: HealthCaseRow; action: CaseAction } | null>(null);
  const [viewing, setViewing] = useState<HealthCaseRow | null>(null);
  const [notice, setNotice] = useState("");
  const today = useMemo(() => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10), []);

  const counts = useMemo(() => ({
    active: cases.filter(c => c.status === "OPEN" || c.status === "MONITORING").length,
    resolved: cases.filter(c => c.status === "RESOLVED").length,
    closed: cases.filter(c => c.status === "CLOSED").length,
    all: cases.length,
  }), [cases]);
  const shown = cases.filter(c => filter === "all" || (filter === "active" ? c.status === "OPEN" || c.status === "MONITORING" : c.status.toLowerCase() === filter));
  // Anything that needs a person comes first: overdue reviews, unreported notifiable cases, then the most serious.
  const order = (c: HealthCaseRow) => (attention(c, today).length ? 0 : 1) * 10 + ({ URGENT: 0, HIGH: 1, MODERATE: 2, LOW: 3 } as Record<string, number>)[c.severity];
  const sorted = [...shown].sort((a, b) => filter === "active" ? order(a) - order(b) || b.openedAt.localeCompare(a.openedAt) : b.openedAt.localeCompare(a.openedAt));

  return (
    <section className="section">
      <div className="section-head">
        <div><h3>Health cases</h3><p>A case stays open until someone resolves it, and keeps its history after it is closed.</p></div>
        <div className="actions"><a className="button" href="/inspections">Flock inspections</a>{canWrite && <button type="button" className="button button-primary" onClick={onNew}>Record a problem</button>}</div>
      </div>
      <div className="section-tabs" role="tablist" aria-label="Case status">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
            {label}<span className="tab-count">{counts[id]}</span>
          </button>
        ))}
      </div>
      {notice && <div className="card" role="status"><strong>{notice}</strong></div>}
      {sorted.length === 0
        ? <div className="card empty">{cases.length === 0 ? "No flock health problems recorded." : filter === "active" ? "No active cases. Everything recorded has been resolved or closed." : "Nothing here yet."}</div>
        : <div className="list">{sorted.map(c => <CaseCard key={c.id} row={c} today={today} canDecide={canDecide} canWrite={canWrite} onAct={action => { setNotice(""); setActing({ row: c, action }); }} onView={() => setViewing(c)} />)}</div>}
      <ActionDialog target={acting} today={today} onClose={() => setActing(null)} onDone={message => { setActing(null); setNotice(message); onChanged(); }} />
      <HistoryDialog row={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}

function CaseCard({ row, today, canDecide, canWrite, onAct, onView }: { row: HealthCaseRow; today: string; canDecide: boolean; canWrite: boolean; onAct: (a: CaseAction) => void; onView: () => void }) {
  const flags = attention(row, today);
  const openDays = Math.max(0, Math.floor((Date.parse((row.closedAt ?? row.resolvedAt ?? today).slice(0, 10) + "T00:00:00Z") - Date.parse(day(row.openedAt) + "T00:00:00Z")) / 86_400_000));
  const activeTreatments = (row.treatments ?? []).filter(t => t.status === "ACTIVE").length;
  const pendingTests = (row.diagnosticTests ?? []).filter(t => t.status === "PENDING").length;
  const active = row.status === "OPEN" || row.status === "MONITORING";
  return (
    <article className="card case-card">
      <div className="case-head">
        <div>
          <strong>{row.caseNumber} · {row.title}</strong>
          <span className="case-meta">
            {row.batch?.name ?? "Farm-wide"} · {row.affectedCount} affected · {row.deathsCount} deaths · {active ? `open ${openDays} day${openDays === 1 ? "" : "s"}` : `lasted ${openDays} day${openDays === 1 ? "" : "s"}`}
            {row.reopenedCount ? ` · reopened ${row.reopenedCount}×` : ""}
          </span>
        </div>
        <div className="case-chips">
          <span className={`status-chip status-${row.status.toLowerCase()}`}>{STATUS_LABEL[row.status]}</span>
          <span className={`pill ${row.severity.toLowerCase()}`}>{row.severity}</span>
        </div>
      </div>
      {(flags.length > 0 || row.notifiable) && (
        <div className="case-flags">
          {flags.map(f => <span className="flag flag-warn" key={f}>{f}</span>)}
          {row.notifiable && row.reportedToAuthorityAt && <span className="flag">Reported to Veterinary Services {day(row.reportedToAuthorityAt)}{row.authorityReference ? ` · ${row.authorityReference}` : ""}</span>}
          {(row.movementRestricted || row.isolationRecommended) && active && <span className="flag flag-warn">{row.movementRestricted ? "Movement restricted" : "Isolation advised"}</span>}
        </div>
      )}
      <p className="case-facts">
        {row.status === "MONITORING" && row.nextReviewAt ? <>Next review <strong>{day(row.nextReviewAt)}</strong>. </> : null}
        {row.outcome ? <>Outcome: <strong>{OUTCOMES[row.outcome as keyof typeof OUTCOMES] ?? row.outcome}</strong>. </> : null}
        {row.confirmedDiagnosis ? <>Diagnosis: <strong>{row.confirmedDiagnosis}</strong>. </> : row.suspectedCause ? <>Suspected: {row.suspectedCause}. </> : null}
        {activeTreatments > 0 ? `${activeTreatments} treatment${activeTreatments === 1 ? "" : "s"} running. ` : ""}
        {pendingTests > 0 ? `${pendingTests} test result${pendingTests === 1 ? "" : "s"} pending.` : ""}
      </p>
      <div className="row-actions case-actions">
        <button type="button" className="button" onClick={onView}>History</button>
        {canWrite && active && <button type="button" className="button" onClick={() => onAct("note")}>Add update</button>}
        {canWrite && row.status === "OPEN" && <button type="button" className="button" onClick={() => onAct("monitor")}>Start monitoring</button>}
        {canWrite && row.status === "MONITORING" && <button type="button" className="button" onClick={() => onAct("escalate")}>Got worse</button>}
        {canWrite && active && !row.reportedToAuthorityAt && <button type="button" className="button" onClick={() => onAct("report")}>Record report</button>}
        {canDecide && active && <button type="button" className="button-primary" onClick={() => onAct("resolve")}>Resolve</button>}
        {canDecide && row.status === "RESOLVED" && <button type="button" className="button-primary" onClick={() => onAct("close")}>Close case</button>}
        {canDecide && (row.status === "RESOLVED" || row.status === "CLOSED") && <button type="button" className="button" onClick={() => onAct("reopen")}>Reopen</button>}
      </div>
    </article>
  );
}

function ActionDialog({ target, today, onClose, onDone }: { target: { row: HealthCaseRow; action: CaseAction } | null; today: string; onClose: () => void; onDone: (message: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      setError("");
      setF({ note: "", nextReviewAt: plusDays(today, 2), severity: target.row.severity, affectedCount: String(target.row.affectedCount), deathsCount: String(target.row.deathsCount), outcome: "", confirmedDiagnosis: "", liftRestrictions: false, notifiable: false, reportedToAuthorityAt: today, authorityReference: "" });
      dialog.showModal();
    }
    if (!target && dialog.open) dialog.close();
  }, [target, today]);

  if (!target) return <dialog ref={ref} className="ui-dialog" onClose={onClose} />;
  const { row, action } = target;
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF(prev => ({ ...prev, [key]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const restricted = row.movementRestricted || row.isolationRecommended;
  const countsForm = action === "note" || action === "escalate" || action === "monitor" || action === "resolve";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = { action, note: f.note };
      if (action === "monitor") body.nextReviewAt = f.nextReviewAt;
      if (countsForm) { body.severity = f.severity; body.affectedCount = Number(f.affectedCount); body.deathsCount = Number(f.deathsCount); }
      if (action === "resolve") { body.outcome = f.outcome; body.confirmedDiagnosis = f.confirmedDiagnosis; body.liftRestrictions = f.liftRestrictions; }
      if (action === "note" && f.notifiable) body.notifiable = true;
      if (action === "report") { body.reportedToAuthorityAt = f.reportedToAuthorityAt; body.authorityReference = f.authorityReference; }
      const response = await fetch("/api/health/cases?id=" + encodeURIComponent(row.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That did not save.");
      onDone(`${row.caseNumber}: ${ACTION_TITLE[action].toLowerCase()} saved.${data.withdrawalNote ? " " + data.withdrawalNote : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : "That did not save."); } finally { setBusy(false); }
  }

  const noteLabel = action === "reopen" ? "Why is it being reopened?" : action === "escalate" ? "What has got worse?" : action === "close" ? "Closing note (optional)" : action === "resolve" ? "Notes (optional)" : action === "monitor" ? "What are you watching for? (optional)" : "What did you see or do?";
  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby="case-action-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h3 id="case-action-title">{ACTION_TITLE[action]} · {row.caseNumber}</h3>
        <p>{row.title}{row.batch ? ` · ${row.batch.name}` : ""}</p>
        {action === "monitor" && <label>Look at this case again on<input type="date" min={today} value={String(f.nextReviewAt ?? "")} onChange={set("nextReviewAt")} required /></label>}
        {action === "resolve" && <>
          <label>How did it end?
            <select value={String(f.outcome ?? "")} onChange={set("outcome")} required>
              <option value="">Choose…</option>
              {Object.entries(OUTCOMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>Confirmed diagnosis (optional)<input value={String(f.confirmedDiagnosis ?? "")} onChange={set("confirmedDiagnosis")} maxLength={200} /></label>
          {restricted && <label className="check-line"><input type="checkbox" checked={Boolean(f.liftRestrictions)} onChange={set("liftRestrictions")} /> Isolation and movement restrictions are lifted</label>}
        </>}
        {action === "report" && <div className="dialog-grid">
          <label>Date reported<input type="date" max={today} value={String(f.reportedToAuthorityAt ?? "")} onChange={set("reportedToAuthorityAt")} required /></label>
          <label>Their reference (if given)<input value={String(f.authorityReference ?? "")} onChange={set("authorityReference")} maxLength={120} /></label>
        </div>}
        {action !== "report" && <label>{noteLabel}<textarea value={String(f.note ?? "")} onChange={set("note")} required={action === "note" || action === "escalate" || action === "reopen"} maxLength={600} /></label>}
        {countsForm && <div className="dialog-grid">
          <label>Birds affected now<input type="number" min="0" step="1" value={String(f.affectedCount ?? "")} onChange={set("affectedCount")} /></label>
          <label>Deaths so far<input type="number" min={row.deathsCount} step="1" value={String(f.deathsCount ?? "")} onChange={set("deathsCount")} /></label>
          <label>Severity<select value={String(f.severity ?? "")} onChange={set("severity")}><option>LOW</option><option>MODERATE</option><option>HIGH</option><option>URGENT</option></select></label>
        </div>}
        {action === "note" && !row.notifiable && <label className="check-line"><input type="checkbox" checked={Boolean(f.notifiable)} onChange={set("notifiable")} /> Could be a notifiable disease (sudden high deaths, twisted necks, swollen heads): flag it for reporting</label>}
        {action === "close" && <p>Closing freezes the record. Withdrawal periods on any treatment keep running; this does not release the flock for sale.</p>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : ACTION_TITLE[action]}</button>
        </div>
      </form>
    </dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: HealthCaseRow | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (row && !dialog.open) dialog.showModal();
    if (!row && dialog.open) dialog.close();
  }, [row]);
  const lines = useMemo(() => {
    if (!row) return [] as { at: string; kind: string; text: string }[];
    return [
      ...(row.events ?? []).map(e => ({ at: e.createdAt, kind: e.type === "STATUS" ? `${STATUS_LABEL[e.fromStatus ?? ""] ?? ""} → ${STATUS_LABEL[e.toStatus ?? ""] ?? ""}` : e.type === "OPENED" ? "Opened" : e.type === "REPORTED" ? "Reported" : e.type === "FLAGGED" ? "Flagged" : "Update", text: e.note ?? "" })),
      ...(row.observations ?? []).map(o => ({ at: o.observedAt, kind: "Observation", text: `${o.symptom}${o.affectedCount ? ` (${o.affectedCount} birds)` : ""}${o.notes ? ". " + o.notes : ""}` })),
      ...(row.treatments ?? []).map(t => ({ at: t.startedAt, kind: "Treatment", text: `${t.productName}${t.withdrawalClearsAt ? `. Withdrawal clears ${day(t.withdrawalClearsAt)}` : ""}` })),
      ...(row.diagnosticTests ?? []).map(t => ({ at: t.testDate, kind: "Test", text: `${t.testName}: ${t.status.toLowerCase()}${t.resultSummary ? ". " + t.resultSummary : ""}` })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [row]);
  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby="case-history-title" onClose={onClose}>
      <div className="dialog-body">
        <h3 id="case-history-title">{row ? `${row.caseNumber} · ${row.title}` : "History"}</h3>
        {row?.summary && <p>{row.summary}</p>}
        {lines.length === 0 ? <p>Nothing recorded yet.</p> : (
          <ol className="case-timeline">{lines.map((l, i) => <li key={i}><span className="tl-kind">{l.kind}</span><time>{stamp(l.at)}</time>{l.text && <p>{l.text}</p>}</li>)}</ol>
        )}
        <div className="dialog-actions"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    </dialog>
  );
}
