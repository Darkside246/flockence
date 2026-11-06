"use client";
import Link from "next/link";

export type SectionTab = { id: string; label: string; href: string; count?: number };

/** Secondary navigation inside one page: each tab is a real link (?tab=…) so it can be bookmarked and shared. */
export function SectionTabs({ tabs, current, label }: { tabs: SectionTab[]; current: string; label: string }) {
  return (
    <nav className="section-tabs" aria-label={label}>
      {tabs.map(tab => (
        <Link key={tab.id} href={tab.href} scroll={false} aria-current={tab.id === current ? "true" : undefined} className={tab.id === current ? "active" : ""}>
          {tab.label}{typeof tab.count === "number" && <span className="tab-count">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
