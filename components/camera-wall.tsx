"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export type CameraWallStatus = { state: "loading" | "unavailable" | "ready"; count: number; message?: string };
type Cam = { name: string; source: "blink" | "rtsp"; battery?: string | number | null; live?: boolean; recording?: boolean };

const enc = encodeURIComponent;
const time = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Real camera previews from the camera service. Never simulates footage and shows LIVE only for an active stream. */
export function CameraWall({ limit = 4, onStatus }: { limit?: number; onStatus?: (s: CameraWallStatus) => void }) {
  const [cams, setCams] = useState<Cam[] | null>(null);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState(() => Date.now());
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [loadedAt, setLoadedAt] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/cameras/cameras", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Camera service is not available.");
      setCams(d as Cam[]);
      setFailed({});
      setStamp(Date.now());
      onStatus?.({ state: "ready", count: (d as Cam[]).length });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Camera service is not available.";
      setCams(null);
      setError(message);
      onStatus?.({ state: "unavailable", count: 0, message });
    }
  }, [onStatus]);

  useEffect(() => { void load(); }, [load]);

  const shown = (cams ?? []).slice(0, limit);

  return <div>
    <div className="cx-section-head">
      <div><div className="hero-kicker">Surveillance</div><h3>Cameras</h3><p>Latest picture from each camera. Open one for live view, pictures and recordings.</p></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="button" onClick={() => void load()}>Refresh</button>
        <Link className="button" href="/cameras">All cameras</Link>
      </div>
    </div>
    {error && <div className="card cx-empty" role="status"><strong>Cameras unavailable</strong>{error} Start the camera service, then press Refresh.</div>}
    {!error && cams === null && <div className="cx-cams" role="status" aria-busy="true" aria-label="Connecting to cameras">{[0, 1, 2, 3].slice(0, limit).map((i) => <div key={i} className="card cx-cam cx-skel" />)}</div>}
    {!error && cams?.length === 0 && <div className="card cx-empty"><strong>No cameras connected</strong>Add a network (RTSP) camera or connect a Blink account on the Cameras page.</div>}
    {shown.length > 0 && <div className="cx-cams">
      {shown.map((c) => <Link key={c.name} className="card cx-cam" href={`/cameras?camera=${enc(c.name)}`} aria-label={`Open ${c.name}`}>
        {!failed[c.name] && !loadedAt[c.name] && <div className="cx-cam-wait cx-skel" aria-hidden="true" />}
        {failed[c.name]
          ? <div className="cx-cam-offline"><div><strong>No picture available</strong>The camera did not return an image.</div></div>
          // eslint-disable-next-line @next/next/no-img-element
          : <img className={loadedAt[c.name] ? "is-loaded" : ""} src={`/api/cameras/cameras/${enc(c.name)}/snapshot?t=${stamp}`} alt={`Latest picture from ${c.name}`} decoding="async"
              onLoad={() => setLoadedAt((m) => ({ ...m, [c.name]: time() }))} onError={() => setFailed((m) => ({ ...m, [c.name]: true }))} />}
        <div className="cx-cam-top"><span className="cx-cam-name">{c.name}</span><span className="cx-tag">{c.source === "blink" ? "Blink" : "RTSP"}</span></div>
        <div className="cx-cam-bottom">
          {c.live ? <span className="cx-tag live">● Live</span> : failed[c.name] ? <span className="cx-tag off">Offline</span> : <span className="cx-tag">Still{loadedAt[c.name] ? ` · ${loadedAt[c.name]}` : ""}</span>}
          {c.source === "blink" && c.battery != null ? <span className="cx-tag">Battery {String(c.battery)}</span> : c.recording ? <span className="cx-tag live">Recording</span> : <span />}
        </div>
      </Link>)}
    </div>}
    {(cams?.length ?? 0) > limit && <p className="cx-sub" style={{ marginTop: 10 }}>{(cams?.length ?? 0) - limit} more on the Cameras page.</p>}
  </div>;
}
