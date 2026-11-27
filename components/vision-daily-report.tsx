"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/auth-gate";

type Data = { settings: { enabled: boolean; hour: number }; people: { name: string; role: string; wantsReports: boolean; you: boolean }[]; email: boolean };

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** The daily Vision email settings, in the Vision tab of Cameras (owners and managers). */
export function VisionDailyReport() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const isOwner = useSession()?.role === "OWNER";

  useEffect(() => {
    fetch("/api/vision/daily-report", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;

  async function save(next: Data["settings"]) {
    setSaving(true); setMessage("");
    try {
      const r = await fetch("/api/vision/daily-report", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not save.");
      setData((prev) => prev && { ...prev, settings: d.settings });
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const receiving = data.people.filter((p) => p.wantsReports);
  const you = data.people.find((p) => p.you);
  return <section className="card">
    <h3>Daily email report</h3>
    <p className="muted">Once a day, a short email with the last 24 hours: what needs checking first, each area&apos;s condition, your flock records and what the cameras covered. It is not sent on a day with no pictures and nothing open.</p>
    <div className="vision-intel-controls">
      <label>Daily report<select value={data.settings.enabled ? "on" : "off"} disabled={saving || !isOwner} onChange={(e) => save({ ...data.settings, enabled: e.target.value === "on" })}>
        <option value="on">On</option><option value="off">Off</option>
      </select></label>
      <label>Send at (farm time)<select value={data.settings.hour} disabled={saving || !isOwner || !data.settings.enabled} onChange={(e) => save({ ...data.settings, hour: Number(e.target.value) })}>
        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
      </select></label>
    </div>
    <p>{receiving.length ? `Goes to: ${receiving.map((p) => p.name + (p.you ? " (you)" : "")).join(", ")}.` : "Nobody receives it yet."}{" "}
      {you && !you.wantsReports && <>To receive it, tick &ldquo;Farm reports&rdquo; on your <a href="/account">Account page</a>.</>}</p>
    <p className="muted">Owners and managers each choose for themselves on their Account page.{!isOwner && " Only the farm owner can change when it is sent."}</p>
    {!data.email && <p className="notice">Email is not set up on this server (RESEND_API_KEY and RESEND_FROM), so no report can be sent yet.</p>}
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
