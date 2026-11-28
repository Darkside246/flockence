"use client";

import { useEffect, useState } from "react";

type Pen = { id: string; name: string };
type Member = { id: string; name: string; role: string };

/**
 * Team page: which pens each Farm Hand records for. No pens ticked means every pen. Farm Hands still see the whole farm;
 * the API refuses their records for flocks outside their pens (lib/pen-access.ts).
 */
export function TeamPenAccess({ members }: { members: Member[] }) {
  const [pens, setPens] = useState<Pen[]>([]);
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [savingId, setSavingId] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/team/pen-assignments", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (data) { setPens(Array.isArray(data.pens) ? data.pens : []); setAssigned(data.assignments ?? {}); }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const hands = members.filter((m) => m.role === "WORKER");
  if (!loaded || !hands.length) return null;

  async function toggle(userId: string, penId: string) {
    const current = assigned[userId] ?? [];
    const next = current.includes(penId) ? current.filter((p) => p !== penId) : [...current, penId];
    setSavingId(userId); setNote("");
    try {
      const response = await fetch("/api/team/pen-assignments", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, pens: next }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save the pens.");
      setAssigned((a) => ({ ...a, [userId]: data.pens }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save the pens.");
    } finally { setSavingId(""); }
  }

  return <section className="section card">
    <div className="section-head"><div><div className="hero-kicker">Pen access</div><h3>Pens each Farm Hand records for</h3><p>Farm Hands see the whole farm. Tick pens to limit what they can record to flocks placed in those pens. Leave all unticked to allow every pen.</p></div></div>
    {note && <p role="alert">{note}</p>}
    {!pens.length ? <div className="empty"><strong>No pens set up yet.</strong><span>Add pens under Farm Vision to assign them here.</span></div> : <div className="list">
      {hands.map((hand) => {
        const mine = assigned[hand.id] ?? [];
        return <article className="card" key={hand.id}>
          <strong>{hand.name}</strong>
          <span className="muted">{mine.length ? `Records for ${mine.length} of ${pens.length} pens` : "Records for every pen"}</span>
          <fieldset disabled={savingId === hand.id} style={{ border: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
            <legend className="visually-hidden">Pens for {hand.name}</legend>
            {pens.map((pen) => <label key={pen.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={mine.includes(pen.id)} onChange={() => void toggle(hand.id, pen.id)}/>{pen.name}
            </label>)}
          </fieldset>
        </article>;
      })}
    </div>}
  </section>;
}
