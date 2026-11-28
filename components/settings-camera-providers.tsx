"use client";

import { WyzeBridgeLink } from "@/components/wyze-bridge-link";
import { WyzeCloudSignIn } from "@/components/wyze-cloud-sign-in";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BlinkConnectCard, NetworkCameraSetup, cameraApi, cameraJson, type Camera, type Status } from "@/components/camera-connection-controls";
import { CameraGateways } from "@/components/camera-gateways";

const providers = {
  blink: "Blink",
  wyze: "Wyze",
  network: "Other network cameras",
} as const;

type Provider = keyof typeof providers;

export function SettingsCameraProviders() {
  const [provider, setProvider] = useState<Provider | "">("");
  const [status, setStatus] = useState<Status | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const options = { cache: "no-store", signal: controller.signal } as const;
    setLoading(true);
    setError("");
    try {
      const connection = await cameraJson<Status>(cameraApi("status"), options);
      if (controller.signal.aborted) return;
      setStatus(connection);
      if (connection.pending2fa) setProvider((current) => current || "blink");
      if (!connection.available) {
        setCameras(null);
        setCheckedAt(null);
        return;
      }
      const discovered = await cameraJson<Camera[]>(cameraApi("cameras"), options);
      if (controller.signal.aborted) return;
      setCameras(discovered);
      setCheckedAt(new Date());
    } catch (error) {
      if (controller.signal.aborted) return;
      setCameras(null);
      setCheckedAt(null);
      setStatus(null);
      setError(error instanceof Error ? error.message : "Camera setup is temporarily unavailable.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => activeRequest.current?.abort();
  }, [refresh]);

  const availableCameras = cameras?.filter((camera) =>
    provider === "blink" ? camera.source === "blink" : camera.source === "rtsp");

  return <>
    <section className="section card">
      <div className="section-head">
        <div><h2>Camera connections</h2><p>Choose a provider to connect a camera or check what this farm can see.</p></div>
        <Link href="/cameras" className="button">Open Cameras</Link>
      </div>
      <label>Camera provider
        <select value={provider} onChange={(event) => setProvider(event.target.value as Provider | "")}>
          <option value="">Select a provider</option>
          {Object.entries(providers).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </label>
    </section>

    {provider === "wyze" && <WyzeCloudSignIn />}
    {provider === "wyze" && <section className="section card">
      <h2>Live Wyze video</h2>
      <p>Watch live on the Wyze website, or connect an on-farm bridge below for a camera feed inside Flockence.</p>
      <a className="button" href="https://my.wyze.com/live" target="_blank" rel="noopener noreferrer">Open Wyze live view</a>
      <p><a href="https://support.wyze.com/hc/en-us/articles/360026245231-Wyze-Cam-RTSP" target="_blank" rel="noopener noreferrer">Check Wyze model compatibility</a></p>
    </section>}

    {(provider === "blink" || provider === "network") && <section className="section card">
      <div className="section-head">
        <div><h2>{provider === "blink" ? "Blink cameras" : "Network cameras"}</h2></div>
        <button type="button" className="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Checking…" : "Refresh camera list"}</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {error.includes("requires Flockence Premium") && <p><Link href="/settings/plan">View your farm plan</Link></p>}
      {status && !status.available && <p>This farm’s private camera service is unavailable. Ask your administrator to check the connection.</p>}
      {provider === "blink" && status?.available && <p role="status">
        {status.connected ? "Blink signed in" : status.pending2fa ? "Waiting for Blink verification" : "Blink is disconnected"}
      </p>}
      {provider === "network" && status?.available && !status.networkCameras && <p>This farm uses a private gateway for network cameras.</p>}
      {provider === "blink" && status?.available && !status.connected && !status.canManage && <p>A farm owner can sign in to Blink.</p>}
      {availableCameras && (provider !== "blink" || status?.connected) && <>
        {availableCameras.length > 0
          ? <ul>{availableCameras.map((camera) => <li key={camera.name}>
            <Link href={"/cameras?camera=" + encodeURIComponent(camera.name)}>{camera.name}</Link>
            {" · "}{provider === "blink" ? "Synced" : camera.recording ? "Recording" : "Added"}
          </li>)}</ul>
          : <p>{provider === "blink" ? "Blink reported no cameras for this account." : "No network cameras are listed."}</p>}
        {checkedAt && <p>Last checked <time dateTime={checkedAt.toISOString()}>{checkedAt.toLocaleString()}</time></p>}
      </>}
    </section>}

    {provider === "blink" && status?.available && status.canManage && !status.connected &&
      <BlinkConnectCard status={status} onDone={refresh} />}
    {provider === "network" && status?.available && status.canManage && status.networkCameras &&
      <NetworkCameraSetup cameras={cameras ?? []} onChange={refresh} />}
    {provider === "wyze" && <WyzeBridgeLink />}
    {(provider === "wyze" || provider === "network") &&
      <CameraGateways key={provider} brand={provider} filterByBrand />}
  </>;
}
