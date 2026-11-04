"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { api, enc, json } from "@/lib/camera-client";
export function LiveView({ camera, source, ffmpeg, compact = false, children }: { camera: string; source: "blink" | "rtsp"; ffmpeg: boolean; compact?: boolean; children?: React.ReactNode }) {
  const [smooth, setSmooth] = useState(false);
  const deadline = useRef(0);
  const restarts = useRef(0);
  const ownsSession = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "starting" | "playing" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const [near, setNear] = useState(false);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);

  const stopRemote = useCallback(async () => {
    ownsSession.current = false;
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
    if (ownsSession.current) fetch(api(`cameras/${enc(camera)}/live/stop`), { method: "POST", keepalive: true }).catch(() => {});
  }, [camera]);

  async function start(retrying = false) {
    if (startAbortRef.current) return;
    if (!retrying) restarts.current = 0;
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
      const { playlist, expiresIn } = await json<{ playlist: string; expiresIn:number }>(api(`cameras/${enc(camera)}/live/start`), { method: "POST" });
      if (!retrying) deadline.current = Date.now()+expiresIn*1000;
      startAccepted = true;
      ownsSession.current = true;
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
        // The sidecar targets one-second Blink segments. Keep a deeper buffer available for jitter.
        const h = new Hls({ liveSyncDurationCount: smooth ? 6 : 2, liveMaxLatencyDurationCount: smooth ? 12 : 4,
          maxLiveSyncPlaybackRate: 1.15, backBufferLength: 10, maxBufferHole: 1 });
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

  useEffect(() => {
    if (state !== "playing") return;
    const run = runRef.current;
    let lastTime = -1, lastProgress = Date.now(), recovering = false;
    const timer = window.setInterval(async () => {
      const el = video.current;
      if (!el || recovering || runRef.current !== run) return;
      if (Date.now() >= deadline.current) {await stop();return;}
      if (el.paused || el.currentTime !== lastTime) {lastTime=el.currentTime;lastProgress=Date.now();return;}
      if (Date.now()-lastProgress < 18000*(1+restarts.current)) return;
      recovering = true;
      clearVideo();
      await stopRemote();
      if (runRef.current !== run) return;
      if (restarts.current >= 2) {setState("failed");setMessage("Live video stopped advancing. Check the camera and storage, then retry.");return;}
      restarts.current++;
      void start(true);
    },2000);
    return ()=>clearInterval(timer);
  },[state,stop,stopRemote,clearVideo]);
  // Near-live fallback: a fresh still every 6 seconds while enabled.
  useEffect(() => { if (!near) return; const t = setInterval(() => setTick((n) => n + 1), 6000); return () => clearInterval(t); }, [near]);

  const player = <video ref={video} aria-label={camera + " live video"} controls playsInline style={{ width: "100%", maxHeight: compact ? undefined : 520, background: "#000", display: state === "playing" ? "block" : "none" }} />;

  return <div className={compact ? "cx-inline-live" : "card"}>
    {compact && <div className="card cx-cam">
      {state !== "playing" && children}
      {player}
    </div>}
    <div className="section-head">{!compact && <div><h3>{camera}</h3><p>{source === "blink" ? "Live view stops automatically after 5 minutes to protect the camera battery." : "Live view stops automatically after 1 hour."}</p></div>}
    <div style={{ display: "flex", gap: 8 }}>
      {state === "playing" || state === "starting"
        ? <button className="button" onClick={stop}>Stop</button>
        : <button className="button" onClick={()=>void start()} disabled={!ffmpeg}>{compact ? "View live" : "Start live view"}</button>}
      {state === "playing" && <button className="button" onClick={() => void video.current?.requestFullscreen?.()}>Fullscreen</button>}
      {!compact && <button className="button" onClick={() => setNear((v) => !v)}>{near ? "Stop near-live" : "Near-live stills"}</button>}</div></div>
    <label className="cx-buffer">Buffer <select value={smooth ? "smooth" : "fast"} disabled={state === "playing" || state === "starting"} onChange={e => setSmooth(e.target.value === "smooth")}>
      <option value="fast">Lower delay</option><option value="smooth">Smoother playback</option></select></label>
    {!ffmpeg && <p role="alert">ffmpeg is not installed on the camera service, so live video is unavailable. Still images and recordings still work.</p>}
    {message && <p role={state === "failed" ? "alert" : "status"}>{message}</p>}
    {!compact && player}
    {near && state !== "playing" && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={api(`cameras/${enc(camera)}/snapshot?fresh=true&t=${tick}`)} alt={`Latest picture from ${camera}`} style={{ width: "100%" }} />
    )}
  </div>;
}
