import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { platformAdministrator, platformStatus } from "@/lib/platform-access";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const request = new Request("http://localhost/platform", { headers: await headers() });
  if (!(await platformAdministrator(request))) notFound();
  const status = platformStatus();
  return <main className="main">
    <section className="section card">
      <h1>Platform diagnostics</h1>
      <p>Server configuration status</p>
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
