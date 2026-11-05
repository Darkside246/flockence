"use client";
import { useState } from "react";
import { api, enc, json } from "@/lib/camera-client";
export type Camera = { temperature?:number|string|null; name: string; source: "blink" | "rtsp"; type: string | null; battery: string | number | null; armed: boolean | null; motionDetected: boolean | null; live: boolean; recording?: boolean };
export type CameraStatus = { storage?: {low:boolean;critical:boolean;freeBytes:number}; connected: boolean; pending2fa: boolean; ffmpeg: boolean };
type Status = CameraStatus;
function ConnectCard({ status, onDone }: { status: Status; onDone: () => void }) {
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const post = async (path: string, body: object) => {
    setBusy(true); setError("");
    try { await json(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); setPassword(""); setPin(""); onDone(); }
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
    finally { setBusy(false); }
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

function ManageCameras({ cameras, onChange, provider }: { provider: string; cameras: Camera[]; onChange: () => void }) {
  const [name, setName] = useState(""), [url, setUrl] = useState(""), [record, setRecord] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [login,setLogin]=useState(""), [password,setPassword]=useState(""), [test,setTest]=useState("");
  const call = async (path: string, init: RequestInit) => {
    setBusy(true); setError("");
    try { await json(api(path), init); onChange(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return false; }
    finally { setBusy(false); }
  };
  async function add(e: React.FormEvent) {
    e.preventDefault();
    let address:URL;
    try { address=new URL(url); if(!["rtsp:","rtsps:"].includes(address.protocol)) throw new Error(); if(login)address.username=login; if(password)address.password=password; } catch {setError("Enter a valid RTSP stream address.");return;}
    if (await call("rtsp/cameras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url:address.href, record, provider }) })) { setName(""); setUrl(""); setPassword("");setLogin("");setRecord(false); }
  }
  const rtspCams = cameras.filter((c) => c.source === "rtsp");
  return <div className="card"><div className="section-head"><div><h3>Network cameras (RTSP)</h3><p>Owner only. The camera address often contains its password, so it is stored on the camera service and never shown again.</p></div></div>
    {rtspCams.map((c) => <div key={c.name} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <strong style={{ flex: 1 }}>{c.name} · {c.type || "RTSP"}</strong>
      <button className="button" disabled={busy} onClick={async()=>{setBusy(true);setTest("");try {
        const r=await fetch(api("cameras/"+enc(c.name)+"/snapshot?fresh=true"),{cache:"no-store"});
        if(!r.ok || !r.headers.get("content-type")?.startsWith("image/") || !(await r.blob()).size)throw new Error();
        setTest(c.name+" returned a picture.");
      }catch{setTest(c.name+" did not return a picture. Check the address and camera login.");}finally{setBusy(false);}}}>Test connection</button>
      <button className="button" disabled={busy} onClick={() => call(`rtsp/cameras/${enc(c.name)}/record/${c.recording ? "stop" : "start"}`, { method: "POST" })}>{c.recording ? "Stop recording" : "Start recording"}</button>
      <button className="button button-danger" disabled={busy} onClick={() => { if (confirm(`Remove ${c.name} and its recordings?`)) call(`rtsp/cameras/${enc(c.name)}`, { method: "DELETE" }); }}>Remove</button></div>)}
    <form onSubmit={add}>
      <label>Camera name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brooder house" maxLength={40} /></label>
      <label>Camera username (if required)<input autoComplete="off" value={login} onChange={e=>setLogin(e.target.value)}/></label>
      <label>Camera password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>RTSP address<input type="password" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtsp://user:password@192.168.1.50:554/stream1" autoComplete="off" spellCheck={false} /></label>
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} style={{ width: "auto" }} />Record continuously (kept 7 days)</label>
      <button className="button" disabled={busy || !name.trim() || !url.trim()}>Add camera</button></form>
    {test && <p role="status">{test}</p>}
    {error && <p role="alert">{error}</p>}</div>;
}

export function CameraSetup({status,cameras,onChange}:{status:Status|null;cameras:Camera[];onChange:()=>Promise<void>}){
  const [provider, setProvider] = useState("Blink");
  return <section className="card" id="camera-settings">
        <h2>Farm camera settings</h2>
        <label>Camera provider<select value={provider} onChange={e => setProvider(e.target.value)}>
          {["Blink", "Wyze", "Reolink", "Amcrest", "Tapo", "Other RTSP"].map(name => <option key={name}>{name}</option>)}
        </select></label>
        {!status ? <p>Connect the farm camera service to configure this provider.</p> : provider === "Blink" ? (status.connected ? <p>Blink account connected.</p> : <ConnectCard status={status} onDone={onChange} />) : <>
          <p>{provider === "Wyze" ? "For Wyze Cam v3, enable RTSP in the Wyze app on supported firmware and copy its stream URL. An existing local bridge URL also works." : "Use a model with RTSP enabled and reachable from the camera service."}</p>
          <ManageCameras provider={provider} key={provider} cameras={cameras} onChange={onChange} />
        </>}
      </section>;
}
