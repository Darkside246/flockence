"use client";
import { FormEvent, useEffect, useRef, useState } from "react";

/** A destructive action that needs the person to type a word (default DELETE) before the button turns on. */
export function TypeToConfirm({ open, title, children, word = "DELETE", actionLabel, onConfirm, onClose }: {
  open: boolean; title: string; children: React.ReactNode; word?: string; actionLabel: string;
  onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { setTyped(""); setError(""); dialog.showModal(); }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typed !== word || busy) return;
    setBusy(true); setError("");
    try { await onConfirm(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  }

  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby="ttc-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={submit}>
        <h3 id="ttc-title">{title}</h3>
        {children}
        <label>Type {word} to confirm
          <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby="ttc-hint" />
        </label>
        <p id="ttc-hint">Capital letters, exactly as shown.</p>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-danger" disabled={typed !== word || busy}>{busy ? "Working…" : actionLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
