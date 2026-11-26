"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Nav } from "@/components/nav";
import type { DeviceReading } from "@/lib/device-readings";

type DeviceLink = { id: string; name: string; observedAt: string | null; devices: DeviceReading[] };
type Registry = { enabled: boolean; owner: boolean; links: DeviceLink[] };
const endpoint = "/api/device-gateways";

const descriptions: Record<DeviceReading["kind"], string> = {
  temperature: "Temperature", humidity: "Humidity", power: "Power",
  door: "Door or contact", leak: "Water leak", switch: "Switch",
};

function displayReading(reading: DeviceReading) {
  if (reading.value === null) return "Unavailable";
  if (reading.kind === "door") return reading.value === "on" ? "Open" : "Closed";
  if (reading.kind === "leak") return reading.value === "on" ? "Water detected" : "Dry";
  if (reading.kind === "switch") return reading.value === "on" ? "On" : "Off";
  if (reading.kind === "temperature") return reading.value + " °C";
  if (reading.kind === "humidity") return reading.value + "%";
  return reading.value + " W";
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Could not load farm devices.");
  return value as T;
}

export default function DevicesPage() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [name, setName] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await request<Registry>(endpoint);
      setRegistry(data);
      if (!data.owner || !data.enabled) setCredential("");
      setClock(Date.now());
      setError("");
    } catch (error) {
      setRegistry(null);
      setCredential("");
      setError(error instanceof Error ? error.message : "Could not load farm devices.");
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setCredential("");
    try {
      const result = await request<{ token: string }>(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      setCredential(result.token);
      setName("");
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not link this gateway.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(link: DeviceLink) {
    if (busy || !window.confirm("Disconnect " + link.name + " and revoke its upload credential?")) return;
    setBusy(true);
    setError("");
    try {
      await request(endpoint + "/" + link.id, { method: "DELETE" });
      setCredential("");
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not disconnect this gateway.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Devices</h1><p>Camera feeds and smart devices linked to your farm.</p></div></div></header>
    <Nav />
    <main className="main">
      <section className="card"><div className="section-head">
        <div><h2>Cameras</h2><p>View your farm’s feeds or connect Blink, Wyze, and compatible network cameras.</p></div>
        <Link className="button" href="/cameras">Open Cameras</Link>
      </div></section>
      <section className="card">
        <div className="section-head">
          <div><h2>Smart devices</h2><p>Readings from Home Assistant gateways connected to this farm.</p></div>
          <button className="button" type="button" onClick={() => void load()}>Refresh readings</button>
        </div>
        {error && <p role="alert">{error}</p>}
        {!registry && !error && <p role="status">Loading devices…</p>}
        {registry && !registry.enabled && <p>Smart device gateway setup is unavailable on this server.</p>}
        {registry?.enabled && registry.owner && <form className="form" onSubmit={add}>
          <label>Gateway name<input required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} placeholder="Barn Home Assistant" /></label>
          <button className="button" type="submit" disabled={busy || !name.trim()}>Link Home Assistant gateway</button>
        </form>}
        {credential && <div>
          <p>Copy this upload credential to your farm gateway. It is shown once and grants upload access to this gateway.</p>
          <label>Gateway credential<textarea rows={3} readOnly value={credential} onFocus={(event) => event.target.select()} spellCheck={false} autoComplete="off" /></label>
          <button className="button" type="button" onClick={() => setCredential("")}>Hide credential</button>
        </div>}
        {registry?.enabled && registry.links.length === 0 && <p>No smart device gateways connected.</p>}
        {registry?.links.map((link) => {
          const stale = link.observedAt && clock - Date.parse(link.observedAt) > 5 * 60_000;
          return <article key={link.id} className="card">
            <div className="section-head">
              <div><h3>{link.name}</h3>
                {!link.observedAt && <p>Waiting for the first readings.</p>}
                {link.observedAt && <p>{stale ? "Readings are stale. " : ""}Gateway last checked <time dateTime={link.observedAt}>{new Date(link.observedAt).toLocaleString()}</time></p>}
              </div>
              {registry.owner && <button className="button" type="button" disabled={busy} onClick={() => void disconnect(link)}>Disconnect gateway</button>}
            </div>
            <div className="grid2">{link.devices.map((reading) => <div key={reading.id}>
              <strong>{reading.name}</strong><p>{descriptions[reading.kind]} · {displayReading(reading)}</p>
            </div>)}</div>
          </article>;
        })}
      </section>
    </main>
  </div>;
}
