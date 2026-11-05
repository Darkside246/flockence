"use client";

type Props = {
  temperatureC: number | null;
  humidityPercent: number | null;
  ammoniaPpm: number | null;
  feedKg: number | null;
  waterLiters: number | null;
  waterToFeedRatio: number | null;
  flocksReporting: number;
  flocksActive: number;
  date?: string;
};

const fmt = (n: number | null, digits = 1) => (n == null ? null : n.toFixed(digits));

function Ring({ fraction, label }: { fraction: number | null; label: string }) {
  const r = 30, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, fraction ?? 0));
  return <div className="cx-ring" role="img" aria-label={label}>
    <svg viewBox="0 0 76 76" aria-hidden="true"><circle className="track" cx="38" cy="38" r={r} fill="none" strokeWidth="5" /><circle className="val" cx="38" cy="38" r={r} fill="none" strokeWidth="5" strokeDasharray={`${f * c} ${c}`} /></svg>
    <span>{fraction == null ? "—" : label.split(" ")[0]}</span>
  </div>;
}

/** Today's recorded environment and feed/water figures. Shows "No reading" when nothing was recorded; no devices are simulated. */
export function EnvWidgets(p: Props) {
  const t = fmt(p.temperatureC);
  return <div className="cx-env">
    <div className="card cx-widget">
      <div className="cx-label">Temperature</div>
      {t ? <><Ring fraction={p.temperatureC == null ? null : p.temperatureC / 45} label={`${t}°C`} /><div className="cx-num" style={{ textAlign: "center" }}>{t}°C</div></> : <div className="cx-na">No reading today</div>}
      <div className="cx-foot cx-na">{p.humidityPercent != null ? `${p.humidityPercent.toFixed(0)}% humidity` : "Humidity: no reading"}</div>
    </div>
    <div className="card cx-widget">
      <div className="cx-label">Air quality</div>
      <div className="metric-value">{p.ammoniaPpm != null ? `${p.ammoniaPpm.toFixed(0)} ppm` : "—"}</div>
      <div className="cx-na">{p.ammoniaPpm != null ? "Highest ammonia in today's checks" : "No ammonia reading today"}</div>
    </div>
    <div className="card cx-widget">
      <div className="cx-label">Feed &amp; water</div>
      <div className="metric-value">{p.feedKg != null ? `${p.feedKg.toFixed(1)} kg` : "—"}</div>
      <div className="cx-na">{p.waterLiters != null ? `${p.waterLiters.toFixed(1)} L water` : "No water recorded"}{p.waterToFeedRatio != null ? ` · ${p.waterToFeedRatio.toFixed(2)} L per kg` : ""}</div>
    </div>
    <div className="card cx-widget">
      <div className="cx-label">Daily Rounds coverage</div>
      <div className="metric-value">{p.flocksReporting} / {p.flocksActive}</div>
      <div className="cx-na">Flocks reporting environmental readings today</div>
    </div>
  </div>;
}
