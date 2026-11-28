"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Nav } from "@/components/nav";
import "../camera-recordings.css";
import { VisionIntelligence } from "@/components/vision-intelligence";
import { BlinkSettings } from "@/components/blink-settings";
import { CameraGateways } from "@/components/camera-gateways";
import { BlinkConnectCard, NetworkCameraSetup, cameraApi as api, cameraJson as json, type Camera, type Status } from "@/components/camera-connection-controls";

type Clip = { id: string; camera: string; source: "blink" | "rtsp" | "import" | "archive"; createdAt: string; media: string; thumbnail: string | null };
type Provider = "blink" | "wyze" | "network";
type Tab = "live" | "stills" | "recordings" | "vision";

const enc = encodeURIComponent;

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

const clipTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Recordings: small thumbnails (about 2 x 1.5 inches; two per row on a phone) so a day of footage fits on one screen.
 * The player stays pinned under the top bar while the list scrolls, so the next clip can be chosen without scrolling
 * back up to the video.
 */
function Recordings({ cameras }: { cameras: Camera[] }) {
  const [period, setPeriod] = useState("7");
  const [camera, setCamera] = useState(""), [clips, setClips] = useState<Clip[] | null>(null), [error, setError] = useState(""), [playing, setPlaying] = useState<Clip | null>(null), [refresh, setRefresh] = useState(0);
  const [autoNext, setAutoNext] = useState(false);
  const [stickyTop, setStickyTop] = useState(8);
  useEffect(() => {
    setClips(null); setError("");
    const query = new URLSearchParams({ period, ...(camera ? { camera } : {}) });
    let active = true;
    json<Clip[]>(api("clips?" + query)).then((clips) => { if (active) setClips(clips); })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [camera, period, refresh]);
  useEffect(() => {
    try { setAutoNext(localStorage.getItem("flockence.clips.autoNext") === "1"); } catch { /* storage unavailable */ }
    // Pin the player just below the top bar when the top bar itself stays on screen.
    const measure = () => {
      const bar = document.querySelector<HTMLElement>(".topbar");
      const pinned = bar && ["sticky", "fixed"].includes(getComputedStyle(bar).position);
      setStickyTop(pinned ? Math.round(bar.getBoundingClientRect().height) + 8 : 8);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const index = playing && clips ? clips.findIndex((c) => c.id === playing.id) : -1;
  const step = (by: number) => { if (clips && index >= 0 && clips[index + by]) setPlaying(clips[index + by]); };
  function chooseAutoNext(on: boolean) {
    setAutoNext(on);
    try { localStorage.setItem("flockence.clips.autoNext", on ? "1" : "0"); } catch { /* storage unavailable */ }
  }
  async function removeImported(clip: Clip) {
    if (!confirm(`Remove this imported clip from ${clip.camera}? The file is deleted from this farm's storage.`)) return;
    try { await json(api(clip.media), { method: "DELETE" }); setPlaying(null); setRefresh((n) => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove the clip"); }
  }
  return <><div className="card recordings-card"><div className="section-head"><div><h3>Stored recordings</h3><p>Available Blink, network camera, and imported clips.</p></div>
    <label>Period<select value={period} onChange={(event) => { setPlaying(null); setPeriod(event.target.value); }}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
    <select value={camera} onChange={(e) => { setPlaying(null); setCamera(e.target.value); }} aria-label="Camera"><option value="">All cameras</option>{cameras.map((c) => <option key={c.name}>{c.name}</option>)}</select></div>
    {error && <p role="alert">{error}</p>}
    <p className="recordings-tools"><a href={api("archives?format=csv")} download>Download archive index (CSV)</a>
      {clips && clips.length > 0 && <label className="recordings-autonext"><input type="checkbox" checked={autoNext} onChange={(e) => chooseAutoNext(e.target.checked)} /> Play the next clip automatically</label>}</p>
    {!clips && !error && <p>Loading recordings…</p>}
    {clips?.length === 0 && <p>No recordings in this period.</p>}
    {playing && <div className="clip-player" style={{ top: stickyTop }} aria-label="Recording player">
      <video key={playing.id} src={playing.source === "blink" ? api(`media/clip?path=${enc(playing.media)}`) : api(playing.media)} controls autoPlay playsInline
        onEnded={() => { if (autoNext) step(1); }} />
      <div className="clip-player-bar">
        <span className="clip-player-title"><strong>{playing.camera}</strong> · {clipTime(playing.createdAt)}{playing.source === "import" ? " · imported" : ""}{clips && index >= 0 ? ` · ${index + 1} of ${clips.length}` : ""}</span>
        <span className="clip-player-actions">
          <button type="button" className="button" onClick={() => step(-1)} disabled={index <= 0} aria-label="Previous clip">‹ Previous</button>
          <button type="button" className="button" onClick={() => step(1)} disabled={!clips || index < 0 || index >= clips.length - 1} aria-label="Next clip">Next ›</button>
          {playing.source === "archive" && <a className="button" href={api(`${playing.media}?download=true`)} download>Download</a>}
          {playing.source === "import" && <button type="button" className="button" onClick={() => void removeImported(playing)}>Remove</button>}
          <button type="button" className="button" onClick={() => setPlaying(null)} aria-label="Close the player">Close</button>
        </span>
      </div>
    </div>}
    {clips && clips.length > 0 && <ul className="clip-grid" aria-label="Recordings">{clips.map((c) => {
      const active = playing?.id === c.id;
      return <li key={c.id}><button type="button" className={"clip-tile" + (active ? " is-playing" : "")} aria-pressed={active} onClick={() => setPlaying(c)}>
        <span className="clip-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.thumbnail ? <img src={api(`media/thumb?path=${enc(c.thumbnail)}`)} alt="" loading="lazy" decoding="async" /> : <span className="clip-thumb-empty" aria-hidden="true">No preview</span>}
          {active && <span className="clip-badge">Playing</span>}
        </span>
        <span className="clip-meta"><strong>{c.camera}</strong><small>{c.source === "import" ? "Imported · " : c.source === "archive" ? "Archived · " : ""}{clipTime(c.createdAt)}</small></span>
      </button></li>;
    })}</ul>}</div>
    <ImportClips cameras={cameras} onDone={() => setRefresh((n) => n + 1)} /></>;
}

export default function CamerasPage() {
  const [status, setStatus] = useState<Status | null>(null), [cameras, setCameras] = useState<Camera[]>([]), [error, setError] = useState(""), [tab, setTab] = useState<Tab>("live"), [selected, setSelected] = useState("");
  // Links such as the daily Vision email open a tab directly: /cameras?tab=vision
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t === "live" || t === "stills" || t === "recordings" || t === "vision") setTab(t); }, []);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [gatewayOwner, setGatewayOwner] = useState(false);
  const load = useCallback(async () => {
    try {
      const s = await json<Status>(api("status")); setStatus(s); setError("");
      if (!s.available) { setCameras([]); return; }
      if (s.pending2fa) setProvider("blink");
      else if (s.canManage && !s.connected) setProvider((current) => current ?? "blink");
      const c = await json<Camera[]>(api("cameras")); setCameras(c); const wanted = new URLSearchParams(window.location.search).get("camera"); setSelected((cur) => cur || (wanted && c.some((x) => x.name === wanted) ? wanted : c[0]?.name) || "");
    } catch (e) { setStatus(null); setCameras([]); setError(e instanceof Error ? e.message : "Unable to reach the camera service."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="shell"><header className="topbar"><div className="brand"><div><div className="hero-kicker">Site security</div><h1>Cameras</h1><p>Live view, latest pictures and recordings from Blink and local network cameras.</p></div><span className="badge">LIVE · STILLS · RECORDINGS</span></div></header><Nav /><main className="main">
    {error && <div className="card" role="alert"><p>{error}</p>
      <button type="button" className="button" onClick={() => void load()}>Check connection again</button>
      {error.includes("requires Flockence Premium") && <p><a href="/settings/plan">View your farm plan</a></p>}
    </div>}
    {status && !status.available && <section className="section card">
      <h2>Camera connection unavailable</h2>
      <p>Ask your Flockence administrator to start this farm’s private camera service. The Blink sign-in form appears here when the service is ready.</p>
      <button type="button" className="button" onClick={() => void load()}>Check connection again</button>
    </section>}
    {status?.available && <>
      {cameras.length === 0 && <>
        <div className="card"><p>No cameras are connected yet. A farm owner can connect a camera or add recordings.</p></div>
        <div className="camera-section"><Recordings cameras={cameras} /></div>
      </>}
      {cameras.length > 0 && <>
        <div className="ds-tabs" role="tablist" aria-label="Camera views">{(["live", "stills", "recordings", "vision"] as Tab[]).map((t) => <button key={t} type="button" role="tab" className="ds-tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "live" ? "Live" : t === "stills" ? "Pictures" : t === "recordings" ? "Recordings" : "Vision"}</button>)}</div>
        {tab === "live" && <>
          <label>Camera<select value={selected} onChange={(e) => setSelected(e.target.value)}>{cameras.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
          {selected && <LiveView key={selected} camera={selected} source={cameras.find((c) => c.name === selected)?.source ?? "rtsp"} ffmpeg={Boolean(status.ffmpeg)} />}</>}
        {tab === "stills" && <Stills cameras={cameras} />}
        {tab === "recordings" && <Recordings cameras={cameras} />}
        {tab === "vision" && <VisionIntelligence cameras={cameras} />}
      </>}
    </>}
    <details className="card camera-setup" open={cameras.length === 0 || undefined}>
      <summary><strong>Camera setup</strong> <span className="muted">Connect cameras, Blink settings and farm gateways</span></summary>
    {(status?.canManage || gatewayOwner) && <>
      <section className="card" aria-label="Camera brand">
        <div className="section-head"><div><h2>Connect a camera</h2><p>Choose the brand or connection type for this farm.</p></div></div>
        <div className="segmented">
          {([["blink", "Blink"], ["wyze", "Wyze"], ["network", "Other network cameras"]] as const).map(([id, label]) =>
            <button key={id} type="button" aria-pressed={provider === id} className={provider === id ? "selected" : ""} onClick={() => setProvider(id)}>{label}</button>
          )}
        </div>
        {provider === "blink" && status?.connected && <p>Blink is connected to this farm.</p>}
        {provider === "wyze" && <p><a href="https://my.wyze.com/live" target="_blank" rel="noopener noreferrer">Open Wyze Web View</a> to sign in to Wyze and watch live. To send snapshots to Flockence, check <a href="https://support.wyze.com/hc/en-us/articles/360026245231-Wyze-Cam-RTSP" target="_blank" rel="noopener noreferrer">which Wyze models support RTSP</a>.</p>}
        {provider === "network" && !status?.networkCameras && <p>Use a private farm gateway to send snapshots from a compatible camera.</p>}
      </section>
      {provider === "blink" && status?.available && !status.connected && <BlinkConnectCard status={status} onDone={load} />}
      {(provider === "network" || provider === "wyze") && status?.available && status.networkCameras && <NetworkCameraSetup cameras={cameras} onChange={load} />}
    </>}
    {status?.available && status.connected && <BlinkSettings owner={status.canManage} />}
    <CameraGateways brand={provider === "wyze" || provider === "network" ? provider : null} onOwner={setGatewayOwner} />
    </details>
  </main></div>;
}
