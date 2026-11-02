"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Nav } from "@/components/nav";

type Camera = { name: string; source: "blink" | "rtsp"; type: string | null; battery: string | number | null; armed: boolean | null; motionDetected: boolean | null; live: boolean; recording?: boolean };
type Clip = { id: string; camera: string; source: "blink" | "rtsp" | "import"; createdAt: string; media: string; thumbnail: string | null };
type Status = { connected: boolean; pending2fa: boolean; ffmpeg: boolean };
type Tab = "live" | "stills" | "recordings";

const api = (p: string) => `/api/cameras/${p}`;
const enc = encodeURIComponent;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.detail || `Request failed (${r.status})`);
  return d as T;
}

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

function LiveView({ camera, source, ffmpeg }: { camera: string; source: "blink" | "rtsp"; ffmpeg: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "starting" | "playing" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const [near, setNear] = useState(false);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);

  const stopRemote = useCallback(async () => {
    await fetch(api(`cameras/${enc(camera)}/live/stop`), { method: "POST", keepalive: true }).catch(() => {});
  }, [camera]);

  const clearVideo = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const el = video.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
  }, []);

  const stop = useCallback(async () => {
    runRef.current += 1;
    const controller = startAbortRef.current;
    startAbortRef.current = null;
    controller?.abort();
    clearVideo();
    setState("idle");
    setMessage("");
    await stopRemote();
  }, [clearVideo, stopRemote]);

  useEffect(() => () => {
    // Invalidate any in-flight start/poll loop before asking the sidecar to stop.
    runRef.current += 1;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const el = video.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    fetch(api(`cameras/${enc(camera)}/live/stop`), { method: "POST", keepalive: true }).catch(() => {});
  }, [camera]);

  async function start() {
    if (startAbortRef.current) return;
    const run = ++runRef.current;
    const controller = new AbortController();
    startAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && runRef.current === run;
    let startAccepted = false;

    setState("starting");
    setMessage("Waking the camera… this can take 10–20 seconds.");
    try {
      // Do not abort the start request itself: the server may already have
      // started FFmpeg. Invalidate the run and send stop if the user cancels.
      const { playlist } = await json<{ playlist: string }>(api(`cameras/${enc(camera)}/live/start`), { method: "POST" });
      startAccepted = true;
      if (!isCurrent()) {
        await stopRemote();
        return;
      }

      const url = api(playlist.replace(/^\//, ""));
      let ready = false;
      for (let i = 0; i < 40; i++) {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (response.ok) {
          ready = true;
          break;
        }
        if (response.status !== 404) {
          throw new Error(`Live playlist request failed (${response.status}).`);
        }
        if (i === 39) {
          throw new Error("The camera did not start streaming.");
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
        if (!isCurrent()) {
          await stopRemote();
          return;
        }
      }

      if (!ready) throw new Error("The camera did not start streaming.");
      if (!isCurrent()) {
        await stopRemote();
        return;
      }

      const Hls = (await import("hls.js")).default;
      if (!isCurrent()) {
        await stopRemote();
        return;
      }
      const el = video.current;
      if (!el) throw new Error("The video player is no longer available.");
      if (Hls.isSupported()) {
        // Play about 6 s behind live (3 pieces of 2 s) so a slow moment from Blink's relay does not freeze the
        // picture; catch up gently instead of jumping. Recover from network and decoding hiccups instead of stopping.
        const h = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, maxLiveSyncPlaybackRate: 1.15, backBufferLength: 10, maxBufferHole: 1 });
        let recoveries = 0;
        h.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || recoveries >= 5) return;
          recoveries += 1;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
        });
        hlsRef.current = h;
        h.loadSource(url);
        h.attachMedia(el);
      } else {
        el.src = url;
      }
      await el.play().catch(() => {});
      if (!isCurrent()) {
        clearVideo();
        await stopRemote();
        return;
      }
      setState("playing");
      setMessage("");
    } catch (e) {
      // Stop/unmount aborts are expected, not user-facing stream failures.
      if (!isCurrent()) {
        if (startAccepted) await stopRemote();
        return;
      }
      setState("failed");
      setMessage(e instanceof Error ? e.message : "Live view failed.");
      await stopRemote();
    } finally {
      if (startAbortRef.current === controller) startAbortRef.current = null;
    }
  }

  // Near-live fallback: a fresh still every 6 seconds while enabled.
  useEffect(() => { if (!near) return; const t = setInterval(() => setTick((n) => n + 1), 6000); return () => clearInterval(t); }, [near]);

  return <div className="card"><div className="section-head"><div><h3>{camera}</h3><p>{source === "blink" ? "Live view stops automatically after 5 minutes to protect the camera battery." : "Live view stops automatically after 1 hour."}</p></div>
    <div style={{ display: "flex", gap: 8 }}>
      {state === "playing" || state === "starting"
        ? <button className="button" onClick={stop}>Stop</button>
        : <button className="button" onClick={start} disabled={!ffmpeg}>Start live view</button>}
      {state === "playing" && <button className="button" onClick={() => void video.current?.requestFullscreen?.()}>Fullscreen</button>}
      <button className="button" onClick={() => setNear((v) => !v)}>{near ? "Stop near-live" : "Near-live stills"}</button></div></div>
    {!ffmpeg && <p role="alert">ffmpeg is not installed on the camera service, so live video is unavailable. Still images and recordings still work.</p>}
    {message && <p role={state === "failed" ? "alert" : "status"}>{message}</p>}
    <video ref={video} controls playsInline style={{ width: "100%", maxHeight: 520, background: "#000", display: state === "playing" ? "block" : "none" }} />
    {near && state !== "playing" && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={api(`cameras/${enc(camera)}/snapshot?fresh=true&t=${tick}`)} alt={`Latest picture from ${camera}`} style={{ width: "100%" }} />
    )}
  </div>;
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

function ManageCameras({ cameras, onChange }: { cameras: Camera[]; onChange: () => void }) {
  const [name, setName] = useState(""), [url, setUrl] = useState(""), [record, setRecord] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const call = async (path: string, init: RequestInit) => {
    setBusy(true); setError("");
    try { await json(api(path), init); onChange(); return true; }
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

export default function CamerasPage() {
  const [status, setStatus] = useState<Status | null>(null), [cameras, setCameras] = useState<Camera[]>([]), [error, setError] = useState(""), [tab, setTab] = useState<Tab>("live"), [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    try {
      const s = await json<Status>(api("status")); setStatus(s); setError("");
      const c = await json<Camera[]>(api("cameras")); setCameras(c); const wanted = new URLSearchParams(window.location.search).get("camera"); setSelected((cur) => cur || (wanted && c.some((x) => x.name === wanted) ? wanted : c[0]?.name) || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reach the camera service."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="shell"><header className="topbar"><div className="brand"><div><div className="hero-kicker">Site security</div><h1>Cameras</h1><p>Live view, latest pictures and recordings from Blink and local network cameras.</p></div><span className="badge">LIVE · STILLS · RECORDINGS</span></div></header><Nav /><main className="main">
    {error && <div className="card" role="alert"><p>{error}</p><p>Start the camera service from services/blink (see its README) and set BLINK_SIDECAR_TOKEN.</p></div>}
    {status && <>
      {!status.connected && <ConnectCard status={status} onDone={load} />}
      {cameras.length === 0 && <>
        <div className="card"><p>No cameras are connected yet. Connect your Blink account above, add a local RTSP camera below, or import clips you downloaded from the Blink app.</p></div>
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
      <ManageCameras cameras={cameras} onChange={load} />
    </>}
  </main></div>;
}
