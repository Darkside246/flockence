"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { AccountPreferences } from "@/lib/account-preferences";

export function AccountPreferencesForm({ initialName, initialPreferences }: {
  initialName: string;
  initialPreferences: AccountPreferences;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);

  function change(key: keyof AccountPreferences, value: boolean) {
    setPreferences(current => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice("");
    setError(false);
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, preferences }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your account.");
      setName(data.name);
      setPreferences(data.preferences);
      setNotice("Account preferences saved.");
      router.refresh();
    } catch (failure) {
      setError(true);
      setNotice(failure instanceof Error ? failure.message : "Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="section card">
    <div className="section-head"><div><h3>Profile and privacy</h3><p>These settings apply to your account on this farm.</p></div></div>
    <form className="form" onSubmit={save}>
      <label>Display name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={120} required /></label>
      <label><input type="checkbox" checked={preferences.allowVisionImages} onChange={event => change("allowVisionImages", event.target.checked)} /> Allow me to send images for Farm Vision analysis</label>
      <h4>Email preferences</h4>
      <p className="muted">Your choices are saved. Automatic farm alerts and report delivery are pending.</p>
      <label><input type="checkbox" checked={preferences.farmAlertEmail} onChange={event => change("farmAlertEmail", event.target.checked)} /> Farm alerts</label>
      <label><input type="checkbox" checked={preferences.farmReportEmail} onChange={event => change("farmReportEmail", event.target.checked)} /> Farm reports</label>
      <button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save preferences"}</button>
      {notice && <p role={error ? "alert" : "status"}>{notice}</p>}
    </form>
  </section>;
}
