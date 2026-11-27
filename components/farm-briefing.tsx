"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { id: string; tone: "info" | "attention" | "urgent"; text: string; action?: { label: string; href: string }; basis?: string };

/** "Today on your farm": the few things that matter, in sentences, each with what to do next. */
export function FarmBriefing() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const load = () => {
    setFailed(false);
    fetch("/api/farm-briefing", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(d => setItems(d.items ?? [])).catch(() => setFailed(true));
  };
  useEffect(load, []);
  return <section className="section card briefing" aria-labelledby="briefing-title">
    <div className="section-head"><div><div className="hero-kicker">Today on your farm</div><h3 id="briefing-title">What matters right now</h3><p>From your records. Warnings use your own settings.</p></div></div>
    {failed ? <p role="alert">The summary could not be loaded. <button type="button" className="button" onClick={load}>Try again</button></p>
      : !items ? <p className="muted">Loading…</p>
      : <><ul className="briefing-list">{(all ? items : [...items.filter(i => i.tone !== "info"), ...items.filter(i => i.tone === "info").slice(0, 4)]).map(i => <li key={i.id} className={`briefing-${i.tone}`}>
          <span className="briefing-mark" aria-hidden="true">{i.tone === "urgent" ? "▲" : i.tone === "attention" ? "●" : "·"}</span>
          <span className="briefing-text">{i.tone !== "info" && <span className="visually-hidden">{i.tone === "urgent" ? "Urgent: " : "Needs attention: "}</span>}{i.text}{i.basis && <small className="muted"> {i.basis}</small>}</span>
          {i.action && <Link className="button" href={i.action.href}>{i.action.label}</Link>}
        </li>)}</ul>
        {!all && items.filter(i => i.tone === "info").length > 4 && <button type="button" className="button" onClick={() => setAll(true)}>Show {items.filter(i => i.tone === "info").length - 4} more</button>}</>}
  </section>;
}
