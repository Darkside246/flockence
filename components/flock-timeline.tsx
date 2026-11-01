"use client";

import Link from "next/link";

type Row = {
  batch: { id: string; name: string; status: string };
  lifecycle: {
    ageDays: number; ageWeeks: number; daysToAgeTarget: number; ageTargetDate: string;
    projectedWeightDate: string | null; adgKgPerDay: number | null; weightReady: boolean;
    recommendation: string; isBeyondSixWeeks: boolean;
  };
  withdrawalBlocked: boolean;
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null);

/** One lifecycle track per active flock: placement to age target, with today's position and the next milestones. */
export function FlockTimeline({ rows }: { rows: Row[] }) {
  return <div>
    <div className="cx-section-head"><div><div className="hero-kicker">Flock lifecycle</div><h3>Where each flock is in its cycle</h3><p>Age, weight and harvest signals are calculated from your recorded flock data.</p></div><Link className="button" href="/batches">All flocks →</Link></div>
    {rows.length === 0
      ? <div className="card cx-empty"><strong>No active flocks</strong>Start a batch and its lifecycle appears here, from placement to harvest.</div>
      : <div className="cx-timeline-list">{rows.map((r) => {
          const total = r.lifecycle.ageDays + Math.max(0, r.lifecycle.daysToAgeTarget);
          const pct = total <= 0 ? 100 : Math.max(2, Math.min(100, (r.lifecycle.ageDays / total) * 100));
          const reached = r.lifecycle.daysToAgeTarget <= 0;
          return <div className="card cx-timeline" key={r.batch.id}>
            <div className="cx-timeline-head">
              <div><strong>{r.batch.name}</strong><span className="cx-na"> · Day {r.lifecycle.ageDays} · Week {r.lifecycle.ageWeeks}</span></div>
              <div className="cx-timeline-tags">
                {r.lifecycle.weightReady && <span className="cx-tag live">Weight ready</span>}
                {r.withdrawalBlocked && <span className="cx-tag off">Withdrawal hold</span>}
                {r.lifecycle.isBeyondSixWeeks && <span className="cx-tag off">Beyond 6 weeks</span>}
              </div>
            </div>
            <div className="cx-track" role="img" aria-label={`${r.batch.name} is ${Math.round(pct)}% of the way to its age target`}>
              <div className="cx-track-fill" style={{ width: `${pct}%` }} />
              <div className="cx-track-now" style={{ left: `${pct}%` }} />
            </div>
            <div className="cx-track-labels">
              <span>Placed</span>
              <span>{reached ? "Age target reached" : `${r.lifecycle.daysToAgeTarget} day(s) to age target${day(r.lifecycle.ageTargetDate) ? ` · ${day(r.lifecycle.ageTargetDate)}` : ""}`}</span>
            </div>
            <div className="cx-timeline-foot cx-na">
              {r.lifecycle.adgKgPerDay != null ? `${(r.lifecycle.adgKgPerDay * 1000).toFixed(0)} g/day gain` : "Weight not recorded"}
              {r.lifecycle.projectedWeightDate ? ` · target weight about ${day(r.lifecycle.projectedWeightDate)}` : ""}
              {r.lifecycle.recommendation && r.lifecycle.recommendation !== "CONTINUE" ? ` · ${r.lifecycle.recommendation.replaceAll("_", " ").toLowerCase()}` : ""}
            </div>
          </div>;
        })}</div>}
  </div>;
}
