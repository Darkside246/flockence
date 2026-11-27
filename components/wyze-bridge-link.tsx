"use client";

import { useEffect, useState } from "react";

const endpoint = "/api/camera-gateway/wyze";
type Status = { enabled: boolean; owner?: boolean; linked?: boolean; lastSync?: string | null; seen?: number };

export function WyzeBridgeLink() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pairing, setPairing] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh(signal?: AbortSignal) {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check the Wyze bridge.");
      setStatus(data);
      setError("");
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Could not check the Wyze bridge.");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);

  async function change(method: "POST" | "DELETE") {
    if (busy) return;
    if (status?.linked && !window.confirm(method === "DELETE" ?
      "Disconnect this bridge? Its current pairing key will stop working." :
      "Replace the current bridge pairing key? The previous key will stop working.")) return;
    setBusy(true);
    setPairing("");
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, { method });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change the bridge connection.");
      if (method === "POST") setPairing(data.token);
      else setNotice("Bridge disconnected.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the bridge connection.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="section card">
    <div className="section-head">
      <div><h2>Wyze Bridge discovery</h2><p>Pair a private bridge to discover selected Wyze cameras and keep their snapshots in this farm.</p></div>
      <button type="button" className="button" onClick={() => void refresh()} disabled={busy}>Check sync status</button>
    </div>
    <p>Sign in to Wyze on the private bridge on your farm network. <a href="https://github.com/Darkside246/flockence/blob/main/docs/CAMERA_GATEWAY.md#wyze-bridge-discovery" target="_blank" rel="noreferrer">Bridge setup instructions</a></p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {status && !status.enabled && <p>The farm's private gateway needs to be configured on the server.</p>}
    {status?.enabled && <p role="status">{status.lastSync ? "Last discovery " + new Date(status.lastSync).toLocaleString() + " · " + status.seen + " selected" :
      status.linked ? "Paired. Waiting for the first discovery sync." : "Bridge disconnected."}</p>}
    {status?.enabled && status.owner && <div className="actions">
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void change("POST")}>{status.linked ? "Replace pairing key" : "Create pairing key"}</button>
      {status.linked && <button className="button" type="button" disabled={busy} onClick={() => void change("DELETE")}>Disconnect bridge</button>}
    </div>}
    {pairing && <label>Pairing key shown once<input readOnly value={pairing} onFocus={event => event.currentTarget.select()} /></label>}
  </section>;
}
