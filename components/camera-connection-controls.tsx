"use client";

import { useState } from "react";

export type Camera = { name: string; source: "blink" | "rtsp"; type: string | null; battery: string | number | null; armed: boolean | null; motionDetected: boolean | null; live: boolean; recording?: boolean };
export type Status = { available: boolean; canManage: boolean; networkCameras: boolean; connected?: boolean; pending2fa?: boolean; ffmpeg?: boolean };
export const cameraApi = (p: string) => `/api/cameras/${p}`;
const enc = encodeURIComponent;

export async function cameraJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.detail || `Request failed (${r.status})`);
  return d as T;
}

export function BlinkConnectCard({ status, onDone }: { status: Status; onDone: () => Promise<void> }) {
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const post = async (path: string, body: object) => {
    setBusy(true); setError("");
    try { await cameraJson(cameraApi(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); await onDone(); }
    catch (e) {
      const message = e instanceof Error ? e.message : "Failed";
      // A verification error can mean the sidecar cleared an MFA challenge
      // after consuming its one-time OAuth state. Refresh status so the card
      // switches back to the login form when another code cannot be used.
      if (path === "auth/verify") {
        await onDone();
        setError(message);
      } else {
        setError(message);
      }
    }
    finally { setPassword(""); setPin(""); setBusy(false); }
  };
  return <div className="card"><div className="section-head"><div><h3>Connect Blink</h3><p>Owner only. Your Blink password is sent once to the local camera service and is not stored; only a session token is kept.</p></div></div>
    {status.pending2fa
      ? <form onSubmit={(e) => { e.preventDefault(); post("auth/verify", { pin }); }}>
          <label>Verification code from Blink<input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>
          <button className="button" disabled={busy || !pin}>Verify</button></form>
      : <form onSubmit={(e) => { e.preventDefault(); post("auth/login", { username, password }); }}>
          <label>Blink email<input type="email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
          <label>Blink password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <button className="button" disabled={busy || !username || !password}>Connect</button></form>}
    {error && <p role="alert">{error}</p>}</div>;
}

export function NetworkCameraSetup({ cameras, onChange }: { cameras: Camera[]; onChange: () => void }) {
  const [name, setName] = useState(""), [url, setUrl] = useState(""), [record, setRecord] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const call = async (path: string, init: RequestInit) => {
    setBusy(true); setError("");
    try { await cameraJson(cameraApi(path), init); onChange(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return false; }
    finally { setBusy(false); }
  };
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call("rtsp/cameras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url, record }) })) { setName(""); setUrl(""); setRecord(false); }
  }
  const rtspCams = cameras.filter((c) => c.source === "rtsp");
  return <div className="card"><div className="section-head"><div><h3>Network cameras (RTSP)</h3><p>Owner only. The camera address often contains its password, so it is stored on the camera service and never shown again.</p></div></div>
    {rtspCams.map((c) => <div key={c.name} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <strong style={{ flex: 1 }}>{c.name}</strong>
      <button className="button" disabled={busy} onClick={() => call(`rtsp/cameras/${enc(c.name)}/record/${c.recording ? "stop" : "start"}`, { method: "POST" })}>{c.recording ? "Stop recording" : "Start recording"}</button>
      <button className="button" disabled={busy} onClick={() => { if (confirm(`Remove ${c.name} and its recordings?`)) call(`rtsp/cameras/${enc(c.name)}`, { method: "DELETE" }); }}>Remove</button></div>)}
    <form onSubmit={add}>
      <label>Camera name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brooder house" maxLength={40} /></label>
      <label>RTSP address<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtsp://user:password@192.168.1.50:554/stream1" autoComplete="off" spellCheck={false} /></label>
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} style={{ width: "auto" }} />Record continuously (kept 7 days)</label>
      <button className="button" disabled={busy || !name.trim() || !url.trim()}>Add camera</button></form>
    {error && <p role="alert">{error}</p>}</div>;
}

