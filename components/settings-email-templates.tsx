"use client";

import { useEffect, useState } from "react";
import { EMAIL_TEMPLATE_LIMITS, type EmailCategory, type EmailTemplateText } from "@/lib/email-templates.mjs";

type Loaded = { categories: EmailCategory[]; templates: Record<string, EmailTemplateText>; delivery: { configured: boolean; welcomeOn: boolean } };
type Notice = { message: string; error?: boolean } | null;

/**
 * Settings > Email (owner only). The wording of each kind of email Flockence sends. The sending service itself
 * (RESEND_API_KEY, RESEND_FROM) is a server setting for the administrator and is never shown or stored here.
 */
export function SettingsEmailTemplates() {
  const [data, setData] = useState<Loaded | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EmailTemplateText>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");

  async function load() {
    const response = await fetch("/api/settings/email-templates", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(body?.error || "Email templates could not be loaded.");
    setData(body);
    setDrafts(body.templates ?? {});
  }
  useEffect(() => { load().catch((e) => setNotice({ message: e instanceof Error ? e.message : "Email templates could not be loaded.", error: true })); }, []);

  const set = (category: string, field: keyof EmailTemplateText, value: string) =>
    setDrafts((d) => ({ ...d, [category]: { ...d[category], [field]: value } }));

  async function save() {
    setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/settings/email-templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templates: drafts }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Email templates could not be saved.");
      setDrafts(body.templates ?? {});
      setData((d) => d && { ...d, templates: body.templates ?? {} });
      setNotice({ message: "Email templates saved. Empty fields use the standard wording." });
    } catch (e) {
      setNotice({ message: e instanceof Error ? e.message : "Email templates could not be saved.", error: true });
    } finally { setSaving(false); }
  }

  async function sendTest(category: string) {
    setTesting(category); setNotice(null);
    try {
      const response = await fetch("/api/settings/email-templates/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.sent) throw new Error(body?.error || "The test email was not sent.");
      setNotice({ message: `Test sent to ${body.to}. It uses the saved template, so save first if you changed it.` });
    } catch (e) {
      setNotice({ message: e instanceof Error ? e.message : "The test email was not sent.", error: true });
    } finally { setTesting(""); }
  }

  if (!data) return <section className="card">{notice ? <p className={notice.error ? "notice notice-danger" : "notice"} role="alert">{notice.message}</p> : <p className="muted">Loading email templates…</p>}</section>;
  const groups = [["account", "Account emails", "Sign-up, welcome and password reset for everyone who uses this Flockence site."], ["farm", "Farm emails", "Invitations and Farm Vision emails sent from your farm."]] as const;
  const dirty = JSON.stringify(drafts) !== JSON.stringify(data.templates);

  return <>
    <section className="card email-delivery">
      <div className="section-head"><div><h2>Email</h2><p>Choose the wording of each email Flockence sends. The link or report inside each email is always included, so a template cannot break it.</p></div>
        <span className={`ds-chip ${data.delivery.configured ? "ok" : "warn"}`}>{data.delivery.configured ? "Sending is set up" : "Sending not set up"}</span></div>
      {!data.delivery.configured && <p className="muted">The server administrator adds the sending service (RESEND_API_KEY and RESEND_FROM) to the server environment. Until then no email is sent, and Free sign-up is paused.</p>}
      {data.delivery.configured && !data.delivery.welcomeOn && <p className="muted">Welcome emails are switched off on this server (FLOCKENCE_WELCOME_EMAIL). The administrator can turn them on.</p>}
      <p className="muted">Placeholders: <code>{"{farm}"}</code> is your farm name; <code>{"{subject}"}</code> is the email&apos;s own subject line.</p>
    </section>
    {notice && <p className={notice.error ? "notice notice-danger" : "ops-message"} role={notice.error ? "alert" : "status"}>{notice.message}</p>}
    {groups.map(([group, title, about]) => {
      const list = data.categories.filter((c) => c.group === group);
      if (!list.length) return null;
      return <section className="card email-group" key={group}>
        <div className="section-head"><div><h2>{title}</h2><p>{about}</p></div></div>
        {list.map((c) => {
          const t = drafts[c.id] ?? {};
          const custom = Boolean(t.subject || t.intro || t.footer);
          return <details className="email-template" key={c.id}>
            <summary><strong>{c.label}</strong> <span className={`ds-chip ${custom ? "info" : "plain"}`}>{custom ? "Customised" : "Standard wording"}</span></summary>
            <p className="ds-field-hint">{c.hint}</p>
            <div className="form">
              <label>Subject<input value={t.subject ?? ""} maxLength={EMAIL_TEMPLATE_LIMITS.subject} placeholder={c.subject} onChange={(e) => set(c.id, "subject", e.target.value)} /></label>
              <label>Opening paragraph (before the standard text)<textarea rows={3} value={t.intro ?? ""} maxLength={EMAIL_TEMPLATE_LIMITS.intro} placeholder="Optional, for example: Hello from {farm}." onChange={(e) => set(c.id, "intro", e.target.value)} /></label>
              <label>Closing line (after the standard text)<textarea rows={2} value={t.footer ?? ""} maxLength={EMAIL_TEMPLATE_LIMITS.footer} placeholder="Optional, for example: {farm} · reply to this email with any questions." onChange={(e) => set(c.id, "footer", e.target.value)} /></label>
              <div className="ds-actions"><button type="button" className="button" disabled={!data.delivery.configured || testing === c.id || dirty} onClick={() => void sendTest(c.id)} title={dirty ? "Save your changes first" : undefined}>{testing === c.id ? "Sending…" : "Send me a test"}</button></div>
            </div>
          </details>;
        })}
      </section>;
    })}
    <div className="ds-actions"><button type="button" className="button button-primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save email templates"}</button></div>
  </>;
}
