"use client";

import { useState } from "react";
import { birdsFromNotes, glance, type Level } from "@/lib/vision-glance-rules.mjs";

export type SavedInspection = {
  id: string; observedAt: string; imageUrl?: string | null; notes?: string | null; category?: string;
  visionAssessment?: {
    status?: string; summary?: string; checks?: string[]; signals?: { category?: string; state?: string; evidence?: string }[];
    source?: { kind?: string; name?: string }; pen?: { name?: string };
    birds?: { visible?: number | null; confidence?: string | null; estimate?: { estimate: number; factor: number; samples: number; shows: number } | null; recorded?: number | null; still?: number };
  } | null;
};

const MARK: Record<Level, string> = { OK: "✓", CHECK: "!", URGENT: "!!", NOT_SEEN: "–" };
const WORD: Record<Level, string> = { OK: "OK", CHECK: "Check", URGENT: "Urgent", NOT_SEEN: "Not seen" };
const STATUS: Record<string, string> = { GOOD: "Looks good", ATTENTION: "Needs attention", WARNING: "Needs attention", CRITICAL: "Urgent", INSUFFICIENT_EVIDENCE: "Not enough seen" };

/** Where a saved inspection came from, in words. */
export function sourceLabel(item: SavedInspection) {
  const a = item.visionAssessment;
  return [a?.pen?.name, a?.source?.kind === "CAMERA" ? `camera ${a.source.name}` : "photo"].filter(Boolean).join(" · ");
}

/** The bird numbers for a saved inspection, from what it saved (newer checks) or its text (older ones). */
export function birdsOf(item: SavedInspection) {
  const b = item.visionAssessment?.birds;
  return b ? { visible: b.visible ?? null, confidence: b.confidence ?? null, estimate: b.estimate ?? null, recorded: b.recorded ?? null, still: b.still ?? 0 } : { ...birdsFromNotes(item.notes), still: 0 };
}

/**
 * A Farm Vision check at a glance: the status and one line, then one line per area (OK, Check, Urgent or Not seen),
 * the top things to do, and a link to the full report. For a camera check, a box to enter the real number of birds,
 * which teaches that camera how much it misses.
 */
export function VisionGlance({ item, showFullLink = true, showCountBox = true }: { item: SavedInspection; showFullLink?: boolean; showCountBox?: boolean }) {
  const g = glance(item.visionAssessment ?? {}, birdsOf(item));
  const isCamera = item.visionAssessment?.source?.kind === "CAMERA";
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  async function sendCount() {
    setNote("");
    const n = Number(actual);
    if (!Number.isInteger(n) || n < 1) { setNote("Enter the number of birds."); return; }
    const r = await fetch("/api/vision/count", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observationId: item.id, actual: n }) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setNote(r?.ok ? d.message : d?.error || "Could not save.");
  }
  return <div className="vision-glance">
    <div className="vision-glance-head">
      <span className={`vision-glance-status is-${g.status.toLowerCase()}`}>{STATUS[g.status] ?? g.status}</span>
      <span className="muted">{new Date(item.observedAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {sourceLabel(item)}</span>
    </div>
    {g.headline && <p className="vision-glance-headline">{g.headline}</p>}
    <ul className="vision-glance-rows">
      {g.rows.map((r) => <li key={r.area} className={`is-${r.level.toLowerCase()}`}>
        <span className="vision-glance-mark" aria-hidden="true">{MARK[r.level]}</span>
        <strong>{r.area}</strong> <span className="vision-glance-word">{WORD[r.level]}</span>
        {r.level !== "NOT_SEEN" && <span className="vision-glance-text">: {r.text}</span>}
      </li>)}
    </ul>
    {g.todo.length > 0 && <><h4>To do</h4><ol className="vision-glance-todo">{g.todo.map((t, i) => <li key={i}>{t}</li>)}</ol></>}
    <div className="vision-glance-foot">
      {showFullLink && <a className="button" href={`/vision/reports?id=${encodeURIComponent(item.id)}`}>Full report</a>}
      {showCountBox && isCamera && <span className="vision-glance-count">
        <label>Real number of birds in the pen<input type="number" inputMode="numeric" min={1} value={actual} onChange={(e) => setActual(e.target.value)} placeholder="e.g. 96" /></label>
        <button type="button" className="button" onClick={() => void sendCount()}>Teach this camera</button>
      </span>}
    </div>
    {note && <p role="status" className="muted">{note}</p>}
  </div>;
}
