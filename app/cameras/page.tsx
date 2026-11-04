"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, enc, json } from "@/lib/camera-client";
import { LiveView } from "@/components/camera-live-view";
import { Nav } from "@/components/nav";

type Camera = { name: string; source: "blink" | "rtsp"; type: string | null; battery: string | number | null; armed: boolean | null; motionDetected: boolean | null; live: boolean; recording?: boolean };
type Clip = { id: string; camera: string; source: "blink" | "rtsp" | "import"; createdAt: string; media: string; thumbnail: string | null };
type Status = { storage?: {low:boolean;critical:boolean;freeBytes:number}; connected: boolean; pending2fa: boolean; ffmpeg: boolean };
type Tab = "live" | "stills" | "recordings";

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

function Stills({ cameras }: { cameras: Camera[] }) {
  const [stamp, setStamp] = useState<Record<string, number>>({}), [busy, setBusy] = useState("");
  function take(name: string) { setBusy(name); setStamp((s) => ({ ...s, [name]: Date.now() })); setTimeout(() => setBusy(""), 8000); }
  return <div className="grid2">{cameras.map((c) => <div className="card" key={c.name}>
    <div className="section-head"><div><h3>{c.name}</h3><p>{c.source === "blink" ? `Battery: ${String(c.battery ?? "unknown")}` : "Network camera"}</p></div>
      <div style={{ display: "flex", gap: 8 }}>
        <a className="button" href={api(`cameras/${enc(c.name)}/snapshot${stamp[c.name] ? `?fresh=true&t=${stamp[c.name]}` : ""}`)} download={`${c.name.trim().replace(/s+/g, "-")}.jpg`} aria-label={`Save the latest picture from ${c.name}`}>Save</a>
        <button className="button" disabled={busy === c.name} onClick={() => take(c.name)}>{busy === c.name ? "Taking picture…" : "Take new picture"}</button></div></div>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={stamp[c.name] || 0} src={api(`cameras/${enc(c.name)}/snapshot${stamp[c.name] ? `?fresh=true&t=${stamp[c.name]}` : ""}`)} alt={`Latest picture from ${c.name}`} style={{ width: "100%" }} />
  </div>)}</div>;
}

/** Add clips downloaded from another app (for example the Blink app) so they appear under Recordings. */
function ImportClips({ cameras, onDone }: { cameras: Camera[]; onDone: () => void }) {
  const [label, setLabel] = useState(""), [when, setWhen] = useState(""), [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [log, setLog] = useState<string[]>([]);

  async function upload(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setLog([]);
    let added = 0;
    for (const file of files) {
      const recorded = when ? new Date(when) : new Date(file.lastModified);
      const query = `camera=${enc(label.trim())}&filename=${enc(file.name)}&created_at=${enc(recorded.toISOString())}`;
      try {
        const r = await fetch(api(`imports/clips?${query}`), { method: "POST", headers: { "content-type": file.type || "video/mp4" }, body: file });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || d.detail || `Upload failed (${r.status})`);
        added++; setLog((l) => [...l, `Added ${file.name}`]);
      } catch (err) { setLog((l) => [...l, `Could not add ${file.name}: ${err instanceof Error ? err.message : "failed"}`]); }
    }
    setBusy(false);
    if (added) { setFiles([]); onDone(); }
  }

  return <div className="card" style={{ marginTop: 16 }}><div className="section-head"><div><h3>Import clips</h3><p>Blink clips can&apos;t be fetched automatically right now. Download them in the Blink app, then add them here under the camera&apos;s name. MP4 or MOV, up to 500 MB each.</p></div></div>
    <form onSubmit={upload}>
      <label>Camera name<input list="import-cameras" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Backyard" maxLength={60} /></label>
      <datalist id="import-cameras">{cameras.map((c) => <option key={c.name} value={c.name.trim()} />)}</datalist>
      <label>Video files<input type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
      <label>When were they recorded? (optional)<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <p className="cx-na">Leave the time empty to use each file&apos;s own date.</p>
      <button className="button" disabled={busy || !label.trim() || files.length === 0}>{busy ? "Adding…" : `Import ${files.length || ""} clip${files.length === 1 ? "" : "s"}`}</button>
    </form>
    {log.length > 0 && <ul role="status" style={{ margin: "12px 0 0", paddingLeft: 18 }}>{log.map((l) => <li key={l}>{l}</li>)}</ul>}
  </div>;
}

function Recordings({ cameras }: { cameras: Camera[] }) {
  const [camera, setCamera] = useState(""), [clips, setClips] = useState<Clip[] | null>(null), [error, setError] = useState(""), [playing, setPlaying] = useState<Clip | null>(null), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setClips(null); setError("");
    json<Clip[]>(api(`clips${camera ? "?camera=" + enc(camera) : ""}`)).then(setClips).catch((e) => setError(e.message));
  }, [camera, refresh]);
  async function removeImported(clip: Clip) {
    if (!confirm(`Remove this imported clip from ${clip.camera}? The file is deleted from this farm's storage.`)) return;
    try { await json(api(clip.media), { method: "DELETE" }); setPlaying(null); setRefresh((n) => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove the clip"); }
  }
  return <><div className="card"><div className="section-head"><div><h3>Stored recordings</h3><p>Motion clips from the last 7 days, plus any clips you import.</p></div>
    <select value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="Camera"><option value="">All cameras</option>{cameras.map((c) => <option key={c.name}>{c.name}</option>)}</select></div>
    {error && <p role="alert">{error}</p>}
    {!clips && !error && <p>Loading recordings…</p>}
    {clips?.length === 0 && <p>No recordings in this period.</p>}
    {playing && <div style={{ marginBottom: 16 }}>
      <video src={playing.source === "blink" ? api(`media/clip?path=${enc(playing.media)}`) : api(playing.media)} controls autoPlay playsInline style={{ width: "100%", maxHeight: 520, background: "#000" }} />
      <p>{playing.camera} · {new Date(playing.createdAt).toLocaleString()}{playing.source === "import" ? " · imported" : ""}</p>
      {playing.source === "import" && <button className="button" onClick={() => void removeImported(playing)}>Remove this imported clip</button>}</div>}
    <div className="grid2">{clips?.map((c) => <button key={c.id} className="button" onClick={() => setPlaying(c)} style={{ textAlign: "left" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {c.thumbnail ? <img src={api(`media/thumb?path=${enc(c.thumbnail)}`)} alt="" style={{ width: "100%" }} loading="lazy" /> : <div aria-hidden="true" style={{ aspectRatio: "16/9", background: "#000", opacity: 0.6 }} />}
      <div>{c.camera}</div><small>{c.source === "import" ? "Imported · " : ""}{new Date(c.createdAt).toLocaleString()}</small></button>)}</div></div>
    <ImportClips cameras={cameras} onDone={() => setRefresh((n) => n + 1)} /></>;
}

function ManageCameras({ cameras, onChange, provider }: { provider: string; cameras: Camera[]; onChange: () => void }) {
  const [name, setName] = useState(""), [url, setUrl] = useState(""), [record, setRecord] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const call = async (path: string, init: RequestInit) => {
    setBusy(true); setError("");
    try { await json(api(path), init); onChange(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return false; }
    finally { setBusy(false); }
  };
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call("rtsp/cameras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url, record, provider }) })) { setName(""); setUrl(""); setRecord(false); }
  }
  const rtspCams = cameras.filter((c) => c.source === "rtsp");
  return <div className="card"><div className="section-head"><div><h3>Network cameras (RTSP)</h3><p>Owner only. The camera address often contains its password, so it is stored on the camera service and never shown again.</p></div></div>
    {rtspCams.map((c) => <div key={c.name} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <strong style={{ flex: 1 }}>{c.name} · {c.type || "RTSP"}</strong>
      <button className="button" disabled={busy} onClick={() => call(`rtsp/cameras/${enc(c.name)}/record/${c.recording ? "stop" : "start"}`, { method: "POST" })}>{c.recording ? "Stop recording" : "Start recording"}</button>
      <button className="button" disabled={busy} onClick={() => { if (confirm(`Remove ${c.name} and its recordings?`)) call(`rtsp/cameras/${enc(c.name)}`, { method: "DELETE" }); }}>Remove</button></div>)}
    <form onSubmit={add}>
      <label>Camera name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brooder house" maxLength={40} /></label>
      <label>RTSP address<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtsp://user:password@192.168.1.50:554/stream1" autoComplete="off" spellCheck={false} /></label>
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} style={{ width: "auto" }} />Record continuously (kept 7 days)</label>
      <button className="button" disabled={busy || !name.trim() || !url.trim()}>Add camera</button></form>
    {error && <p role="alert">{error}</p>}</div>;
}

export default function CamerasPage() {
  const [provider, setProvider] = useState("Blink");
  const [status, setStatus] = useState<Status | null>(null), [cameras, setCameras] = useState<Camera[]>([]), [error, setError] = useState(""), [tab, setTab] = useState<Tab>("live"), [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    try {
      const s = await json<Status>(api("status")); setStatus(s); setError("");
      const c = await json<Camera[]>(api("cameras")); setCameras(c); const wanted = new URLSearchParams(window.location.search).get("camera"); setSelected((cur) => cur || (wanted && c.some((x) => x.name === wanted) ? wanted : c[0]?.name) || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reach the camera service."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="shell"><header className="topbar"><div className="brand"><div><div className="hero-kicker">Site security</div><h1>Cameras</h1><p>Live view, latest pictures and recordings from Blink and local network cameras.</p></div><span className="badge">LIVE · STILLS · RECORDINGS</span></div></header><Nav /><main className="main">
    <Link className="button" href="/">← Back to dashboard</Link>
    {error && <div className="card" role="alert"><p>{error}</p><button className="button" onClick={load}>Retry camera connection</button></div>}
      {status?.storage?.low && <p role="alert">Camera drive has {(status.storage.freeBytes / 2**30).toFixed(1)} GiB free. {status.storage.critical ? "Recording and live capture are paused until space is available." : "Free space before recording stops at 2 GiB."}</p>}
      <section className="card" id="camera-settings">
        <h2>Farm camera settings</h2>
        <label>Camera provider<select value={provider} onChange={e => setProvider(e.target.value)}>
          {["Blink", "Wyze", "Reolink", "Amcrest", "Tapo", "Other RTSP"].map(name => <option key={name}>{name}</option>)}
        </select></label>
        {!status ? <p>{error ? "Reconnect the camera service to configure this provider." : "Checking camera service…"}</p> : provider === "Blink" ? (status.connected ? <p>Blink account connected.</p> : <ConnectCard status={status} onDone={load} />) : <>
          <p>{provider === "Wyze" ? "For Wyze Cam v3, enable RTSP in the Wyze app on supported firmware and copy its stream URL. An existing local bridge URL also works." : "Use a model with RTSP enabled and reachable from the camera service."}</p>
          <ManageCameras provider={provider} key={provider} cameras={cameras} onChange={load} />
        </>}
      </section>
    {status && <>
      {cameras.length === 0 && <>
        <div className="card"><p>No cameras are connected yet. Connect your Blink account or add a network camera in Farm camera settings, or import clips you downloaded from the Blink app.</p></div>
        <div style={{ marginTop: 16 }}><Recordings cameras={cameras} /></div>
      </>}
      {cameras.length > 0 && <>
        <div className="segmented" style={{ marginBottom: 18 }}>{(["live", "stills", "recordings"] as Tab[]).map((t) => <button key={t} className={tab === t ? "selected" : ""} onClick={() => setTab(t)}>{t === "live" ? "Live" : t === "stills" ? "Pictures" : "Recordings"}</button>)}</div>
        {tab === "live" && <>
          <label>Camera<select value={selected} onChange={(e) => setSelected(e.target.value)}>{cameras.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
          {selected && <LiveView key={selected} camera={selected} source={cameras.find((c) => c.name === selected)?.source ?? "rtsp"} ffmpeg={status.ffmpeg} />}</>}
        {tab === "stills" && <Stills cameras={cameras} />}
        {tab === "recordings" && <Recordings cameras={cameras} />}
      </>}

    </>}
  </main></div>;
}
