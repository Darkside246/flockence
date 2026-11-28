import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { platformAdministrator, platformStatus } from "@/lib/platform-access";
import { platformFarmOverview } from "@/lib/platform-overview";
import { formatUsd, platformTotals, QUIET_DAYS } from "@/lib/platform-overview-rules.mjs";
import { formatBytes } from "@/lib/storage-quota-rules.mjs";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Barbados" }) : "—");

export default async function PlatformPage() {
  const request = new Request("http://localhost/platform", { headers: await headers() });
  if (!(await platformAdministrator(request))) notFound();
  const status = platformStatus();
  const rows = await platformFarmOverview();
  const totals = platformTotals(rows);
  return <main id="main" tabIndex={-1} className="main">
    <section className="section card">
      <h1>Platform console</h1>
      <p>Every farm on this Flockence. Counts only; farm records stay with each farm. Visible to platform administrators only.</p>
    </section>

    <section className="section dashboard-grid">
      <div className="card metric-card"><div className="metric-label">Farms</div><div className="metric-value">{totals.farms}</div><div className="metric-foot">{totals.needAttention} need a look</div></div>
      <div className="card metric-card"><div className="metric-label">People</div><div className="metric-value">{totals.members}</div><div className="metric-foot">accounts across all farms</div></div>
      <div className="card metric-card"><div className="metric-label">Active flocks</div><div className="metric-value">{totals.activeFlocks}</div><div className="metric-foot">across all farms</div></div>
      <div className="card metric-card"><div className="metric-label">Farm Vision this month</div><div className="metric-value">{totals.visionChecks}</div><div className="metric-foot">checks · {formatUsd(totals.visionCostMicros)} · {formatBytes(totals.storageBytes)} stored</div></div>
    </section>

    <section className="section card">
      <div className="section-head"><div><div className="hero-kicker">Farms</div><h3>All farms</h3><p>Farms needing a look come first: deletion pending, no owner, or nothing logged for {QUIET_DAYS} days.</p></div></div>
      {!rows.length ? <div className="empty">No farms yet.</div> : <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Farm</th><th>Owner</th><th>People</th><th>Active flocks</th><th>Last change logged</th><th>Vision this month</th><th>Pictures stored</th><th>Created</th><th>Needs a look</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td><strong>{r.name}</strong><br/><span className="muted">{r.id}</span></td>
          <td>{r.owners.length ? r.owners.map((o) => <div key={o.email}>{o.name}<br/><span className="muted">{o.email}</span></div>) : "—"}</td>
          <td>{r.members}</td>
          <td>{r.activeFlocks}</td>
          <td>{day(r.lastActivity)}</td>
          <td>{r.visionChecks} · {formatUsd(r.visionCostMicros)}</td>
          <td>{formatBytes(r.storageBytes)}</td>
          <td>{day(r.createdAt)}</td>
          <td>{r.flags.length ? r.flags.join(", ") : "—"}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="section card">
      <h2>Server configuration</h2>
      <dl>
        <dt>Email delivery</dt><dd>{status.emailDeliveryConfigured ? "Configured" : "Unavailable"}</dd>
        <dt>Welcome email</dt><dd>{status.welcomeEmailEnabled ? "Enabled" : "Disabled"}</dd>
        <dt>AI vision</dt><dd>{status.aiVisionConfigured ? "Configured" : "Unavailable"}</dd>
        <dt>Oriya sign-in</dt><dd>{status.oriyaSignInConfigured ? "Configured" : "Unavailable"}</dd>
        <dt>Restricted PostgreSQL connection</dt><dd>{status.databaseIsolationConfigured ? "Configured" : "Unavailable"}</dd>
        <dt>Premium enforcement</dt><dd>{status.premiumEnforcementEnabled ? "Enabled" : "Staging rollout"}</dd>
      </dl>
    </section>
  </main>;
}
