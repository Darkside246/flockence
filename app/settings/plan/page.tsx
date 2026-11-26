"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/nav";

type Plan = { state: "PREMIUM" | "FREE" | "EXISTING" | "UNAVAILABLE"; subscriptionUrl?: string };
const premium = [
  ["Cameras", "/cameras", "Live views and recordings from connected cameras."],
  ["Farm Vision", "/vision", "Photo and camera inspections with recorded findings."],
  ["Smart devices", "/devices", "Connected sensors and farm devices."],
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
  const active = plan?.state === "PREMIUM" || plan?.state === "EXISTING";
  const status = plan?.state === "FREE" ? "Upgrade required" : active ? "Included" : plan ? "Unavailable" : "Checking plan…";
  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Plan &amp; devices</h1><p>See which tools your farm can use.</p></div></div></header>
    <Nav />
    <main className="main">
      <section className="section card">
        <Link href="/settings#devices">Back to settings</Link>
        <h2>{plan?.state === "PREMIUM" ? "Premium" : plan?.state === "FREE" ? "Free" : plan?.state === "EXISTING" ? "Existing access" : plan ? "Plan unavailable" : "Checking plan…"}</h2>
        <p>Flock and pen records, regular reports and offline mortality capture are included.</p>
        {plan?.subscriptionUrl && <a className="button" href={plan.subscriptionUrl}>Manage subscription in Oriya</a>}
      </section>
      <section className="section grid2" aria-label="Premium features">
        {premium.map(([title, href, description]) => <article className="card" key={href}>
          <h2>{title}</h2><p>{description}</p>
          {active ? <Link className="button" href={href}>Open {title}</Link> : <p>Premium · {status}</p>}
        </article>)}
      </section>
    </main>
  </div>;
}
