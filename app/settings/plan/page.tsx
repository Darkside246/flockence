"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { formatBytes } from "@/lib/storage-quota-rules.mjs";

type Plan = { state: "PREMIUM" | "STANDARD" | "FREE" | "EXISTING" | "UNAVAILABLE"; linked?: boolean; subscriptionUrl?: string; storage?: { used: number; limit: number; percent: number; level: "ok" | "warn" | "full"; label: string } };
const premium = [
  ["Cameras", "/cameras", "Live views and recordings from connected cameras.", ""],
  ["Farm Vision", "/vision", "Photo and camera inspections with recorded findings.", "Free includes 10 photo checks a month, findings, reports and the daily email. Camera and automatic checks come with Premium."],
  ["Smart devices", "/devices", "Connected sensors and farm devices.", ""],
];

export default function PlanPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    let fresh = true;
    fetch("/api/settings/plan", { cache: "no-store" }).then(async (result) => {
      if (!result.ok) throw new Error();
      if (fresh) setPlan(await result.json());
    }).catch(() => { if (fresh) setPlan({ state: "UNAVAILABLE" }); });
    return () => { fresh = false; };
  }, []);
  const active = plan?.state === "PREMIUM" || plan?.state === "STANDARD" || plan?.state === "EXISTING";
  const status = plan?.state === "FREE" ? "Upgrade required" : active ? "Included" : plan ? "Unavailable" : "Checking plan…";
  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Plan &amp; devices</h1><p>See which tools your farm can use.</p></div></div></header>
    <Nav />
    <main className="main">
      <section className="section card">
        <Link href="/settings#devices">Back to settings</Link>
        <h2>{plan?.state === "PREMIUM" ? "Premium" : plan?.state === "STANDARD" ? "Standard" : plan?.state === "FREE" ? "Free" : plan?.state === "EXISTING" ? "Existing access" : plan ? "Plan unavailable" : "Checking plan…"}</h2>
        <p>Flock and pen records, regular reports and offline mortality capture are included.</p>
        {plan?.storage && <div className="plan-storage">
          <div className="finance-head"><span>Farm Vision picture storage</span><strong>{formatBytes(plan.storage.used)} of {formatBytes(plan.storage.limit)}</strong></div>
          <div className="bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.storage.percent} aria-label="Picture storage used"><div className={`bar-fill${plan.storage.level === "ok" ? "" : " cost"}`} style={{ width: `${Math.max(2, plan.storage.percent)}%` }} /></div>
          <p className="muted">Free 1 GB, Standard 10 GB, Premium 50 GB. When it is full, pictures older than 90 days are removed first; the written results stay.{plan.storage.level !== "ok" ? ` Now ${plan.storage.percent}% full.` : ""}</p>
        </div>}
        {plan?.subscriptionUrl ? <a className="button button-primary" href={plan.subscriptionUrl}>{plan.state === "PREMIUM" ? "Manage subscription in Oriya" : "Upgrade in Oriya"}</a>
          : plan && plan.state !== "UNAVAILABLE" && plan.state !== "PREMIUM" && <p className="muted">Plans are bought through Oriya. Link this farm to its Oriya business to upgrade.</p>}
      </section>
      <section className="section grid2" aria-label="Premium features">
        {premium.map(([title, href, description, freeNote]) => <article className="card" key={href}>
          <h2>{title}</h2><p>{description}</p>
          {active ? <Link className="button" href={href}>Open {title}</Link>
            : freeNote && plan?.state === "FREE" ? <><p>{freeNote}</p><Link className="button" href={href}>Open {title}</Link></>
            : <p>Premium · {status}</p>}
        </article>)}
      </section>
    </main>
  </div>;
}
