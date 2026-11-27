"use client";

import { useEffect, useState } from "react";

/** The bird counter card (Vision Intelligence phase 2): off until a machine runs it; then the owner can switch it on. */
export function VisionDetector() {
  const [data, setData] = useState<{ available: boolean; on: boolean; canChange: boolean } | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/vision/detector", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  return <section className="card">
    <h3>Bird counter</h3>
    <p className="muted">A separate counting model that finds every bird in a picture: exact counts for reports, and birds that stay still between frames while others move, so possible dead or down birds are found sooner. It adds facts to each check; Vision still describes the pen.</p>
    {data.available
      ? <label><input type="checkbox" checked={data.on} disabled={!data.canChange} onChange={async (e) => {
          const on = e.target.checked;
          setMessage("");
          const r = await fetch("/api/vision/detector", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).catch(() => null);
          const d = await r?.json().catch(() => ({}));
          if (r?.ok) setData({ ...data, on }); else setMessage(d?.error || "Could not save.");
        }} /> Use the bird counter on this farm&apos;s checks{!data.canChange && " (only the owner can change this)"}</label>
      : <p>Not running yet. It needs its own machine with a graphics card; it is built and ready to switch on then.</p>}
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
