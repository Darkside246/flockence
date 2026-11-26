"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Brand = "wyze" | "network";
type Feed = { id: string; name: string; brand: Brand; capturedAt: string | null };
type Setup = { enabled: boolean; owner: boolean; feeds: Feed[] };
const endpoint = "/api/camera-gateway";
const frameUrl = (id: string) => endpoint + "/" + encodeURIComponent(id) + "/frame";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load private camera feeds.");
  return data as T;
}

export function CameraGateways({ brand, onOwner }: { brand: Brand | null; onOwner: (owner: boolean) => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Setup>(endpoint);
      setSetup(data);
      onOwner(data.owner);
      setError("");
    } catch (error) {
      setSetup(null);
      setToken("");
      onOwner(false);
      setError(error instanceof Error ? error.message : "Could not load private camera feeds.");
    }
  }, [onOwner]);
  useEffect(() => { void load(); }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brand || busy) return;
    setBusy(true);
    setError("");
    setToken("");
    try {
      const feed = await api<Feed & { token: string }>(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, brand }),
      });
      setToken(feed.token);
      setName("");
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create the feed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(feed: Feed) {
    if (busy || !window.confirm("Remove " + feed.name + " and revoke its gateway credential?")) return;
    setBusy(true);
    setError("");
    try {
      await api(frameUrl(feed.id), { method: "DELETE" });
      setToken("");
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not remove the feed.");
    } finally {
      setBusy(false);
    }
  }

  if (!setup?.enabled && !(brand && setup?.owner) && !error) return null;
  return <section className="card" aria-label="Private camera feeds">
    <div className="section-head"><div><h2>Private camera snapshots</h2><p>Latest pictures sent from a gateway on your farm.</p></div>
      {setup?.enabled && <button className="button" type="button" onClick={() => void load()}>Refresh snapshots</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {!setup?.enabled && <p>Snapshot gateway setup is unavailable.</p>}
    {setup?.enabled && setup.owner && brand && <form className="form" onSubmit={add}>
      <label>Camera name<input required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} placeholder={brand === "wyze" ? "Wyze barn camera" : "Barn camera"} /></label>
      <button type="submit" className="button" disabled={busy || !name.trim()}>Create snapshot feed</button>
    </form>}
    {token && <div>
      <p>Copy this upload credential to your farm gateway. It is shown once.</p>
      <label>Upload credential<textarea readOnly value={token} onFocus={(event) => event.target.select()} rows={3} spellCheck={false} autoComplete="off" /></label>
      <button className="button" type="button" onClick={() => setToken("")}>Hide credential</button>
    </div>}
    {setup?.enabled && setup.feeds.length === 0 && <p>No snapshot feeds yet.</p>}
    {!!setup?.feeds.length && <div className="grid2">
      {setup.feeds.map((feed) => <article className="card" key={feed.id}>
        <h3>{feed.name}</h3>
        {feed.capturedAt
          ? <><img src={frameUrl(feed.id) + "?at=" + encodeURIComponent(feed.capturedAt)} alt={"Latest camera snapshot from " + feed.name} loading="lazy" style={{ width: "100%", height: "auto" }} />
              <p><time dateTime={feed.capturedAt}>{new Date(feed.capturedAt).toLocaleString()}</time></p></>
          : <p>Waiting for the first picture from your gateway.</p>}
        {setup.owner && <button className="button" type="button" disabled={busy} onClick={() => void remove(feed)}>Remove feed</button>}
      </article>)}
    </div>}
  </section>;
}
