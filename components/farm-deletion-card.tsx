"use client";

import { FormEvent, useEffect, useState } from "react";

type State = { pending: boolean; deleteAfter?: string; daysLeft?: number; farmName: string; deletable: boolean; graceDays: number };

/** Settings > Farm profile: delete this farm after a grace period, or cancel a pending deletion (owner only). */
export function FarmDeletionCard() {
  const [state, setState] = useState<State | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/farm/deletion", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setState).catch(() => setState(null));
  }, []);

  async function call(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/farm/deletion", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || "That did not work. Try again.");
      setState(data); setTyped(""); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { setBusy(false); }
  }

  if (!state || !state.deletable) return null;
  const when = state.deleteAfter ? new Date(state.deleteAfter).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

  if (state.pending) return <section className="section card danger-zone" aria-labelledby="farm-delete-title">
    <h2 id="farm-delete-title">This farm will be deleted on {when}</h2>
    <p>{state.daysLeft} day{state.daysLeft === 1 ? "" : "s"} left. The farm is locked: only you can sign in. Download the records before then; after that date everything is gone for good.</p>
    <div className="ds-actions"><a className="button" href="/api/export?type=farm">Download all farm records</a>
      <button type="button" className="button button-primary" disabled={busy} onClick={() => void call("DELETE")}>{busy ? "Cancelling…" : "Cancel deletion and keep the farm"}</button></div>
    {error && <p className="notice notice-danger" role="alert">{error}</p>}
  </section>;

  const submit = (event: FormEvent) => { event.preventDefault(); void call("POST", { confirm: typed }); };
  return <section className="section card danger-zone" aria-labelledby="farm-delete-title">
    <h2 id="farm-delete-title">Delete this farm</h2>
    <p>Removes the farm and everything in it: flocks, records, pictures, team members and settings. You get {state.graceDays} days to change your mind; until then the farm is locked and only you can sign in.</p>
    {!open ? <button type="button" className="button button-danger" onClick={() => setOpen(true)}>Delete this farm…</button>
      : <form className="form" onSubmit={submit}>
        <p><a href="/api/export?type=farm">Download all farm records</a> first. You will also get the link by email.</p>
        <label>Type the farm name, <strong>{state.farmName}</strong>, to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
        <div className="ds-actions">
          <button type="submit" className="button button-danger" disabled={busy || typed.trim().toLowerCase() !== state.farmName.trim().toLowerCase()}>{busy ? "Scheduling…" : `Delete in ${state.graceDays} days`}</button>
          <button type="button" className="button" onClick={() => { setOpen(false); setTyped(""); }}>Keep the farm</button>
        </div>
      </form>}
    {error && <p className="notice notice-danger" role="alert">{error}</p>}
  </section>;
}
