"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type Treatment = { id: string; productName: string; startedAt: string; withdrawalDays?: number | null; batch?: { name: string } | null };
type Test = { id: string; testName: string; laboratory?: string | null; batch?: { name: string } | null };

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

/** Finish or stop a treatment. The withdrawal period then runs from the day it ended. */
export function EndTreatmentDialog({ treatment, onClose, onDone }: { treatment: Treatment | null; onClose: () => void; onDone: (message: string) => void }) {
  const ref = useDialog(treatment !== null);
  const today = calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
  const [action, setAction] = useState<"complete" | "stop">("complete");
  const [endedAt, setEndedAt] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (treatment) { setAction("complete"); setEndedAt(today); setNote(""); setError(""); } }, [treatment, today]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!treatment || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/health/treatments?id=" + encodeURIComponent(treatment.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, endedAt, note }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That did not save.");
      onDone(`${treatment.productName} ${action === "stop" ? "stopped" : "finished"}.${data.withdrawalClearsAt ? ` Withdrawal clears ${data.withdrawalClearsAt}.` : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : "That did not save."); } finally { setBusy(false); }
  }
  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby="end-treatment-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h3 id="end-treatment-title">End treatment · {treatment?.productName}</h3>
        <p>{treatment?.batch?.name ?? "Farm-wide"}. The withdrawal period ({treatment?.withdrawalDays ? `${treatment.withdrawalDays} days` : "none recorded"}) counts from the last day of treatment.</p>
        <label>What happened?
          <select value={action} onChange={e => setAction(e.target.value as "complete" | "stop")}>
            <option value="complete">The course was finished</option>
            <option value="stop">It was stopped early</option>
          </select>
        </label>
        <label>Last day of treatment<input type="date" max={today} min={treatment?.startedAt.slice(0, 10)} value={endedAt} onChange={e => setEndedAt(e.target.value)} required /></label>
        <label>Note (optional)<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={400} /></label>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : "End treatment"}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Record what the lab said. A positive result with a confirmed condition is carried to the health case. */
export function TestResultDialog({ test, onClose, onDone }: { test: Test | null; onClose: () => void; onDone: (message: string) => void }) {
  const ref = useDialog(test !== null);
  const [status, setStatus] = useState("NEGATIVE");
  const [condition, setCondition] = useState("");
  const [summary, setSummary] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (test) { setStatus("NEGATIVE"); setCondition(""); setSummary(""); setReference(""); setError(""); } }, [test]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!test || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/health/tests?id=" + encodeURIComponent(test.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, confirmedCondition: condition, resultSummary: summary, reportReference: reference }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That did not save.");
      onDone(`${test.testName}: result recorded.`);
    } catch (e) { setError(e instanceof Error ? e.message : "That did not save."); } finally { setBusy(false); }
  }
  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby="test-result-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h3 id="test-result-title">Record result · {test?.testName}</h3>
        <p>{test?.batch?.name ?? "Farm-wide"} · {test?.laboratory || "lab not recorded"}</p>
        <label>Result
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="NEGATIVE">Negative</option>
            <option value="POSITIVE">Positive</option>
            <option value="INCONCLUSIVE">Inconclusive</option>
          </select>
        </label>
        {status === "POSITIVE" && <label>Confirmed condition<input value={condition} onChange={e => setCondition(e.target.value)} maxLength={200} placeholder="For example: Infectious bronchitis" /></label>}
        <label>What the report says<textarea value={summary} onChange={e => setSummary(e.target.value)} maxLength={600} /></label>
        <label>Lab report number (optional)<input value={reference} onChange={e => setReference(e.target.value)} maxLength={120} /></label>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save result"}</button>
        </div>
      </form>
    </dialog>
  );
}
