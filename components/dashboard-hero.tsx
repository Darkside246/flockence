"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { CxIcon } from "@/components/cx-icons";

export type HeroChip = { label: string; tone: "ok" | "warn" | "off" };
export type HeroAction = readonly [icon: string, label: string, hint: string, href: string];

/** Feature banner for the dashboard: brand headline, a personal greeting, quick actions and real system status. */
export function DashboardHero({ chips, actions }: { chips: HeroChip[]; actions: readonly HeroAction[] }) {
  const session = useSession();
  const [greeting, setGreeting] = useState("");
  const [today, setToday] = useState("");

  // Computed after mount so the server and browser never disagree about time zone or locale.
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
    setToday(new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }, []);

  const first = session?.name?.trim().split(/\s+/)[0];

  return <section className="cx-hero" aria-labelledby="cx-hero-title">
    <div className="cx-hero-photo" aria-hidden="true" />
    <div className="cx-hero-art" aria-hidden="true"><i /><i /><i /></div>
    <div className="cx-hero-body">
      <div className="cx-hero-kicker"><CxIcon name="leaf" size={14} /> Intelligent Poultry Management</div>
      <h1 id="cx-hero-title" className="cx-hero-title">Every flock. <em>Every decision.</em> Connected.</h1>
      <p className="cx-hero-sub">{greeting ? `${greeting}${first ? `, ${first}` : ""}.` : "Welcome back."}{today ? ` ${today}.` : ""} One place for flock health, daily work and the money behind every bird.</p>
      <div className="cx-hero-actions" role="group" aria-label="Quick actions">
        {actions.map(([icon, label, hint, href]) => <Link key={label} href={href} className="cx-action" title={hint}><span className="cx-action-icon"><CxIcon name={icon} size={16} /></span><span>{label}</span></Link>)}
      </div>
    </div>
    <div className="cx-chips cx-hero-chips" role="status" aria-label="System status">
      {chips.map((c) => <span key={c.label} className={`cx-chip ${c.tone}`}><i />{c.label}</span>)}
    </div>
  </section>;
}
