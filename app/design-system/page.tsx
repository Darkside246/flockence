"use client";

import { Nav } from "@/components/nav";

const matrix = [
  { id: "aero", name: "Aero Glass", vibe: "Futuristic command center", bg: "#090D16", card: "#121926", primary: "#FFFFFF", secondary: "#E4EBF2", accent: "#10B981", highlight: "#00F2FE", border: "#86A1B9", status: "Optimal · ●" },
  { id: "heritage", name: "Heritage Sovereign", vibe: "Quiet luxury agriculture", bg: "#121316", card: "#161E1A", primary: "#F8F9FA", secondary: "#E2E8F0", accent: "#E5C378", highlight: "#2DD4BF", border: "#8E9B94", status: "Optimal · ●" },
  { id: "workhorse", name: "Field Workhorse", vibe: "Rugged instrument panel", bg: "#1E2022", card: "#25282B", primary: "#FFFFFF", secondary: "#F0F2F4", accent: "#FFB703", highlight: "#38BDF8", border: "#D9DDE1", status: "Attention · ◆" },
  { id: "sol", name: "Sol Tactical", vibe: "Extreme sunlight contrast", bg: "#000000", card: "#FFFFFF", primary: "#000000", secondary: "#1A1A1A", accent: "#FFE500", highlight: "#00E5FF", border: "#000000", status: "Critical · ■" },
  { id: "terra", name: "Terra Flora", vibe: "Warm agrarian intelligence", bg: "#1A1715", card: "#24201D", primary: "#FFFDF7", secondary: "#F2EDE4", accent: "#86EFAC", highlight: "#FF8C66", border: "#AAA19A", status: "Optimal · ●" }
] as const;

export default function DesignSystemPage() {
  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Flockence design system</h1><p>Theme matrix, accessibility tokens and operator stress-test surface.</p></div><span className="badge">A11Y / UI</span></div></header>
    <Nav />
    <main className="main">
      <section className="hero"><div className="hero-kicker">Design system lead</div><h2>One product. Five operating moods.</h2><p>Every theme changes the visual character while preserving the same information hierarchy, touch targets, status language and semantic data roles.</p></section>

      <section className="section card">
        <div className="section-head"><div><h3>Component matrix</h3><p>Broiler House 1 · Temperature & mortality tile</p></div><span className="pill">BOUNDARY + TEXT TEST</span></div>
        <div className="theme-matrix">
          {matrix.map(theme => <article key={theme.id} className={`theme-sample theme-${theme.id}`} style={{"--sample-bg":theme.bg,"--sample-card":theme.card,"--sample-primary":theme.primary,"--sample-secondary":theme.secondary,"--sample-accent":theme.accent,"--sample-highlight":theme.highlight,"--sample-border":theme.border} as React.CSSProperties}>
            <div className="sample-meta"><strong>{theme.name}</strong><span>{theme.vibe}</span></div>
            <div className="sample-tile">
              <div className="sample-top"><span>Broiler House 1</span><span className="sample-status">{theme.status}</span></div>
              <div className="sample-readout"><div><small>Temperature</small><strong>29.8°C</strong></div><div><small>Mortality</small><strong>1.4%</strong></div></div>
              <div className="sample-bar"><span>Climate trend</span><i /></div>
              <div className="sample-actions"><button>Log reading</button><button>Open house</button></div>
            </div>
          </article>)}
        </div>
      </section>

      <section className="section grid2">
        <div className="card"><div className="section-head"><div><h3>Semantic token architecture</h3><p>Single naming layer across all five themes.</p></div></div><div className="token-list">
          {["--bg-canvas","--surface-card","--surface-elevated","--border-edge","--text-primary","--text-secondary","--accent-interactive","--status-optimal / warning / critical"].map(token => <div key={token}><code>{token}</code><span>Theme-scoped value</span></div>)}
        </div></div>
        <div className="card"><div className="section-head"><div><h3>Accessibility guardrails</h3><p>Operator-first constraints.</p></div></div><div className="token-list">
          <div><strong>AAA body/data</strong><span>Target 7:1 or better</span></div>
          <div><strong>AA large UI</strong><span>Target 4.5:1 or better</span></div>
          <div><strong>Touch targets</strong><span>48×48px minimum</span></div>
          <div><strong>Boundaries</strong><span>1–2px explicit stroke</span></div>
          <div><strong>Status cues</strong><span>Label + icon + shape</span></div>
          <div><strong>200% scaling</strong><span>No clipping or overlap</span></div>
        </div></div>
      </section>

      <section className="section card stress-test"><div className="section-head"><div><h3>Dark-to-light stress test</h3><p>Switch themes from the floating Appearance control. The component retains hierarchy, borders and action affordances.</p></div></div><div className="stress-grid"><div><span>Critical</span><strong>Water unavailable</strong><small>Check tank and nipple line before continuing.</small></div><div><span>Attention</span><strong>Feed access uneven</strong><small>Review feeder placement and flock distribution.</small></div><div><span>Optimal</span><strong>House conditions stable</strong><small>Latest observation is inside the configured range.</small></div></div></section>
    </main>
  </div>;
}
