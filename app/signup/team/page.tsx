"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { farmRoleLabels, type InviteRole } from "@/lib/farm-roles";

type Invite = { farmName: string; role: InviteRole };

async function invitationRequest(input: object) {
  const response = await fetch("/api/auth/team-invite", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not open this invitation.");
  return result;
}

export default function TeamSignupPage() {
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const proof = new URLSearchParams(window.location.hash.slice(1)).get("invite") || "";
    if (!proof) { setError("Open the full invitation link from your email."); return; }
    window.history.replaceState(null, "", window.location.pathname);
    setToken(proof);
    invitationRequest({ action: "inspect", token: proof }).then(setInvite)
      .catch(error => setError(error instanceof Error ? error.message : "Could not open this invitation."));
  }, []);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirm")) { setError("Passwords do not match."); return; }
    setError("");
    setBusy(true);
    try {
      await invitationRequest({ action: "join", token, name: data.get("name"), password: data.get("password") });
      window.location.assign("/");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not accept the invitation.");
    } finally {
      setBusy(false);
    }
  }

  return <main id="main" tabIndex={-1} className="auth-shell"><section className="auth-card">
    <div className="auth-heading"><h1>{invite ? "Join " + invite.farmName : "Join your Flockence team"}</h1>
      <p>{invite ? "Your farm role is " + farmRoleLabels[invite.role] + "." : error ? "" : "Checking your invitation…"}</p>
    </div>
    {invite && <form className="form" onSubmit={join}>
      <label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={120} required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      <small>Use at least 8 characters, including one uppercase letter and one special character.</small>
      <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      <button className="button button-primary" disabled={busy}>{busy ? "Joining…" : "Join the farm"}</button>
    </form>}
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <p className="auth-links"><Link href="/login">Sign in</Link></p>
  </section></main>;
}
