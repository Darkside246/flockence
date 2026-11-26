"use client";

import { useCallback, useEffect, useState } from "react";

type Session = { id: string; current: boolean; signedInAt: string; expiresAt: string };
const endpoint = "/api/auth/sessions";

export function AccountSessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load sign-ins.");
      const data = await response.json() as { sessions: Session[] };
      setSessions(data.sessions);
      setError("");
    } catch {
      setSessions(null);
      setError("Unable to load sign-ins.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(id?: string) {
    if (busy || (!id && !window.confirm("Sign out of Flockence on all your other devices?"))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const query = id ? "?id=" + encodeURIComponent(id) : "?scope=others";
      const result = await fetch(endpoint + query, { method: "DELETE", cache: "no-store" });
      if (!result.ok) throw new Error("Unable to revoke the selected sign-ins.");
      const { revoked } = await result.json() as { revoked: number };
      setNotice(revoked === 1 ? "One session signed out." : revoked > 1 ? revoked + " sessions signed out." : "No other sessions to revoke.");
      await load();
    } catch {
      setError("Unable to revoke the selected sign-ins.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card" aria-labelledby="account-sessions-heading">
    <div className="section-head"><div><h2 id="account-sessions-heading">Flockence sign-ins</h2><p>Review recent sessions and sign out of devices you no longer use.</p></div>
      {sessions && <button type="button" className="button" disabled={busy} onClick={() => void revoke()}>Sign out of other sessions</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!sessions && !error && <p role="status">Loading sign-ins…</p>}
    {sessions?.map((session) => <article className="card" key={session.id}>
      <div className="section-head">
        <div><h3>{session.current ? "This session" : "Other session"}</h3>
          <p>Signed in <time dateTime={session.signedInAt}>{new Date(session.signedInAt).toLocaleString()}</time></p>
          <p>Expires <time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString()}</time></p>
        </div>
        {!session.current && <button type="button" className="button" disabled={busy} onClick={() => void revoke(session.id)}>Sign out</button>}
      </div>
    </article>)}
  </section>;
}
