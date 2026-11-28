"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { Nav } from "@/components/nav";

type Inspection = {
  id: string;
  observedAt: string;
  notes: string | null;
  beddingIssue: boolean;
  ventilationIssue: boolean;
  waterChange: boolean;
  feedChange: boolean;
  temperatureC: string | null;
  humidityPercent: string | null;
  imageUrl: string | null;
  batch: { name: string } | null;
};

export default function InspectionsPage() {
  const session = useSession();
  const [removing, setRemoving] = useState(false);
  const [photoNotice, setPhotoNotice] = useState("");
  const [records, setRecords] = useState<Inspection[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/offline/inspections", { cache: "no-store", signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Could not load inspections.");
        return response.json();
      })
      .then(setRecords)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  async function removePhoto(id: string) {
    if (removing || !window.confirm("Remove the inspection photo? The written inspection will stay in farm history.")) return;
    setRemoving(true);
    setPhotoNotice("");
    try {
      const response = await fetch("/api/offline/inspections", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Could not remove this photo.");
      setRecords(items => items?.map(item => item.id === id ? { ...item, imageUrl: null } : item) ?? null);
      setPhotoNotice("Inspection photo removed.");
    } catch {
      setPhotoNotice("Could not remove this photo.");
    } finally {
      setRemoving(false);
    }
  }

  return <div className="shell">
    <Nav />
    <main id="main" tabIndex={-1} className="main">
      <section className="section card">
        <div className="section-head"><div><h1>Flock inspections</h1><p>Observations and photos synced from the offline workspace.</p></div>
          <Link href="/offline.html" className="button button-primary">Record an inspection</Link>
        </div>
        {photoNotice && <p role="status">{photoNotice}</p>}
        {failed ? <p role="alert">Could not load inspections. Refresh to try again.</p>
          : records === null ? <p role="status">Loading inspections…</p>
          : records.length === 0 && <p>No flock inspections have synced yet.</p>}
      </section>
      {records?.map(record => <article className="section card" key={record.id}>
        <div className="section-head">
          <div><h2>{record.batch?.name ?? "Farm-wide"}</h2><time dateTime={record.observedAt}>{record.observedAt.slice(0, 10)}</time></div>
          {record.imageUrl && <div className="actions">
            <a className="button" href={record.imageUrl}>Download inspection photo</a>
            {session?.role === "OWNER" && <button type="button" className="button" disabled={removing} onClick={() => void removePhoto(record.id)}>Remove photo</button>}
          </div>}
        </div>
        {record.notes && <p style={{ whiteSpace: "pre-wrap" }}>{record.notes}</p>}
        {record.temperatureC !== null && <p>Temperature {record.temperatureC} °C</p>}
        {record.humidityPercent !== null && <p>Relative humidity {record.humidityPercent}%</p>}
        {record.beddingIssue && <p>Bedding needs attention</p>}
        {record.ventilationIssue && <p>Ventilation needs attention</p>}
        {record.waterChange && <p>Change in water use</p>}
        {record.feedChange && <p>Change in feed use</p>}
      </article>)}
    </main>
  </div>;
}
