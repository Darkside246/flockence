"use client";

import { useEffect, useState } from "react";

type Alert = { at: string; held: boolean; emailed: number; findings: { id: string; title: string; severity: string; reason: string; place: string | null }[] };
type Data = { alerts: Alert[]; people: { name: string; you: boolean; wantsAlerts: boolean }[] };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const reasonText: Record<string, string> = { NEW: "New", WORSE: "Worse", STILL_THERE: "Still there" };

/** Recent Vision alerts, in the Vision tab of Cameras (owners and managers). */
export function VisionAlerts() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    fetch("/api/vision/alerts", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const receiving = data.people.filter((p) => p.wantsAlerts);
  const you = data.people.find((p) => p.you);
  return <section className="card">
    <h3>Alerts</h3>
    <p className="muted">Serious findings (urgent, or needing attention soon) are emailed straight away. One problem seen in many pictures is one alert; it is repeated only if it gets worse, or as a reminder if it is still there hours later (at most twice). At most 6 alert emails an hour; anything more goes in the daily report.</p>
    <p>{receiving.length ? `Alert emails go to: ${receiving.map((p) => p.name + (p.you ? " (you)" : "")).join(", ")}.` : "Nobody gets alert emails yet."}{" "}
      {you && !you.wantsAlerts && <>To get them, tick &ldquo;Farm alerts&rdquo; on your <a href="/account">Account page</a>.</>}</p>
    {data.alerts.length ? <ul>{data.alerts.slice(0, 10).map((a, i) => <li key={i}>
      {when(a.at)}: {a.findings.map((f) => `${reasonText[f.reason] ?? f.reason}: ${f.title}${f.place ? ` (${f.place})` : ""}`).join("; ")}
      {" "}<small className="muted">{a.held ? "held for the daily report (hourly limit)" : a.emailed ? `emailed to ${a.emailed}` : "not emailed (nobody chose alert emails)"}</small>
    </li>)}</ul> : <p className="muted">No alerts yet.</p>}
  </section>;
}
