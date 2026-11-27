"use client";

import { useEffect, useState } from "react";

type Section = { key: string; title: string; lines: string[] };

/**
 * "What Vision already knows" on the Farm Vision page: the farm's own records that go with this check, most useful for
 * the chosen kind of check first. The farmer only needs to add what the records cannot show.
 */
export function VisionKnown({ category, batchId, penId }: { category: string; batchId: string; penId: string }) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [chosen, setChosen] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams({ category });
    if (batchId) q.set("batchId", batchId);
    if (penId) q.set("penId", penId);
    const controller = new AbortController();
    fetch("/api/vision/context?" + q, { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setSections(d.sections); setChosen(Boolean(d.flockChosenForYou)); } })
      .catch(() => undefined);
    return () => controller.abort();
  }, [category, batchId, penId]);
  if (!sections) return null;
  const useful = sections.filter((s) => s.key !== "TIME");
  return <details className="vision-known card" open>
    <summary><strong>What Vision already knows</strong> <span className="muted">from your farm records, sent with this check</span></summary>
    {useful.length ? <dl>
      {useful.map((s) => <div key={s.key}><dt>{s.title}</dt><dd><ul>{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></dd></div>)}
    </dl> : <p className="muted">No flock is chosen, so only the time and any sensors are sent. Choose a batch or pen above.</p>}
    {chosen && <p className="muted">The flock was picked for you: the only active flock, or the one in this pen.</p>}
  </details>;
}
