"use client";

import { type FormEvent, useState } from "react";

export function AccountPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    if (data.get("newPassword") !== data.get("confirm")) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not change your password.");
      window.location.assign("/login");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="section card">
    <div className="section-head"><div><h3>Change password</h3><p>Changing your password signs you out on every device.</p></div></div>
    <form className="form" onSubmit={changePassword}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      <small>Use at least eight characters, including an uppercase letter and a special character.</small>
      {error && <p role="alert">{error}</p>}
      <button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
    </form>
  </section>;
}
