"use client";

import { useEffect, useState } from "react";

type Data = { settings: { timeline: boolean; keepDays: number }; canChange: boolean };

/** People and privacy (Vision Intelligence phase 5): the people timeline is off until the owner switches it on. */
export function VisionPeople() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/vision/people", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  async function save(next: Data["settings"]) {
    setMessage("");
    if (!next.timeline && data!.settings.timeline && !window.confirm("Switch the people timeline off? The people data already kept will be removed.")) return;
    const r = await fetch("/api/vision/people", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (r?.ok) { setData({ ...data!, settings: d.settings }); setMessage("Saved."); } else setMessage(d?.error || "Could not save.");
  }
  const s = data.settings;
  return <section className="card">
    <h3>People and privacy</h3>
    <p className="muted">Vision always checks for animals and pests in the house (rats, mice, wild birds, dogs, cats). For people it never identifies anyone: no faces, names or descriptions. It can only note how many people are in view, the work being done, and whether boots and coveralls are worn.</p>
    <label><input type="checkbox" checked={s.timeline} disabled={!data.canChange} onChange={(e) => save({ ...s, timeline: e.target.checked })} /> Keep a people timeline (when people were in the house, and protective clothing)</label>
    {s.timeline && <label>Keep it for<select value={s.keepDays} disabled={!data.canChange} onChange={(e) => save({ ...s, keepDays: Number(e.target.value) })}>
      {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
    </select></label>}
    <p className="muted">{s.timeline ? `People data is removed automatically after ${s.keepDays} days.` : "Off: nothing about people is saved."}{!data.canChange && " Only the owner can change this."}</p>
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
