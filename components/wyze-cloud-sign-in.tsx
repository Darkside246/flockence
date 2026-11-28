"use client";

import { useCallback, useEffect, useState } from "react";

const endpoint = "/api/cameras/wyze-cloud";
type Status = {
  enabled: boolean; serverKey: boolean; connected: boolean; email: string | null; connectedAt: string | null;
  waitingForCode: "totp" | "sms" | null; owner: boolean; cameras: { name: string; model: string; thumbnailAt: string | null }[]; problem: string | null;
};

/**
 * Settings → Camera connections → Wyze: sign in the way the Wyze app does (email, password, then a code if the account
 * uses two-factor). The API key fields only appear when the server has no Wyze key of its own, or Wyze refused it.
 */
export function WyzeCloudSignIn() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState<"totp" | "sms" | null>(null);
  const [ownKey, setOwnKey] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [apiKey, setApiKey] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check Wyze.");
      setStatus(data); setNeedsCode(data.waitingForCode); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check Wyze."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function send(body: Record<string, string | undefined>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (data.needsOwnKey) setOwnKey(true);
      if (!response.ok) throw new Error(data.error || "Wyze did not accept the sign-in.");
      if (data.needsCode) { setNeedsCode(data.needsCode); setPassword(""); return; }
      setPassword(""); setCode(""); setNeedsCode(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Wyze did not accept the sign-in."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Wyze? Flockence stops reading these cameras until an owner signs in again.")) return;
    setBusy(true);
    await fetch(endpoint, { method: "DELETE" }).catch(() => undefined);
    setBusy(false); await refresh();
  }

  if (!status) return error ? <section className="section card"><h2>Wyze account</h2><p role="alert">{error}</p></section> : null;
  const showKey = ownKey || !status.serverKey;

  return <section className="section card">
    <div className="section-head"><div><h2>Wyze account</h2><p>Sign in with the same email and password you use in the Wyze app. Flockence keeps only an encrypted Wyze sign-in token, never your password.</p></div></div>
    {error && <p role="alert">{error}</p>}
    {!status.enabled && <p>Wyze sign-in is not switched on for this server yet. Ask your administrator.</p>}

    {status.enabled && status.connected && <>
      <p role="status"><strong>Connected</strong> as {status.email}{status.connectedAt ? ` since ${new Date(status.connectedAt).toLocaleDateString()}` : ""}.</p>
      {status.problem && <p role="alert">{status.problem}</p>}
      {status.cameras.length ? <ul>{status.cameras.map((c) => <li key={c.name}><strong>{c.name}</strong>{c.model ? ` · ${c.model}` : ""}{c.thumbnailAt ? ` · latest picture ${new Date(c.thumbnailAt).toLocaleString()}` : " · no picture yet"}</li>)}</ul>
        : !status.problem && <p>Wyze reported no cameras on this account.</p>}
      <p className="muted">Wyze updates each camera's cloud picture when the camera records an event, so a picture can be some hours old.</p>
      {status.owner && <button type="button" className="button" onClick={() => void disconnect()} disabled={busy}>Disconnect Wyze</button>}
    </>}

    {status.enabled && !status.connected && !status.owner && <p>A farm owner can sign in to Wyze.</p>}

    {status.enabled && !status.connected && status.owner && !needsCode && <form className="form grid2" onSubmit={(e) => { e.preventDefault(); void send({ step: "password", email, password, ...(showKey ? { keyId, apiKey } : {}) }); }}>
      <label>Wyze email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254}/></label>
      <label>Wyze password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256}/></label>
      {showKey && <>
        <p className="muted" style={{ gridColumn: "1 / -1" }}>Wyze also asks for an API key from your own account. Sign in at <a href="https://developer-api-console.wyze.com" target="_blank" rel="noopener noreferrer">developer-api-console.wyze.com</a>, choose Create a key, and copy both values here. <a href="https://support.wyze.com/hc/en-us/articles/16129834216731-Creating-an-API-Key" target="_blank" rel="noopener noreferrer">Wyze's guide</a></p>
        <label>API Key ID<input value={keyId} onChange={(e) => setKeyId(e.target.value)} required maxLength={128} autoComplete="off"/></label>
        <label>API key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required maxLength={256} autoComplete="off"/></label>
      </>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to Wyze"}</button>
    </form>}

    {status.enabled && !status.connected && status.owner && needsCode && <form className="form grid2" onSubmit={(e) => { e.preventDefault(); void send({ step: "code", code }); }}>
      <p style={{ gridColumn: "1 / -1" }}>{needsCode === "sms" ? "Wyze sent a code by text message to the phone on your Wyze account." : "Enter the code from the authenticator app you use for Wyze."}</p>
      <label>Wyze code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,8}" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={8}/></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button>
      <button className="button" type="button" onClick={() => { setNeedsCode(null); setCode(""); }} disabled={busy}>Start again</button>
    </form>}
  </section>;
}
