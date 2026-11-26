"use client";

import { useCallback, useEffect, useId, useState } from "react";

type Mode = "on" | "off" | "auto";
type Camera = {
  name: string; model: string | null; firmware: string | null; system: string | null;
  temperatureC: number | null; battery: string | number | null; wifiSignal: number | null;
  syncSignal: number | null; motionEnabled: boolean | null; motionDetected: boolean | null;
};
type Overview = { systems: { name: string; armed: boolean | null }[]; cameras: Camera[] };
type Change = { kind: "system" | "motion"; name: string; enabled: boolean } | { kind: "nightVision"; name: string; mode: Mode };
const api = "/api/cameras/blink/settings";
const unitKey = "flockence.camera-temperature-unit";

async function request<T>(suffix = "", body?: Change) {
  const response = await fetch(api + suffix, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }
    : { cache: "no-store" });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404 && !body && !suffix) throw new Error("This Blink worker needs the camera settings update.");
    throw new Error(typeof value.detail === "string" ? value.detail : value.error || "Blink settings are unavailable.");
  }
  return value as T;
}

export function BlinkSettings({ owner }: { owner: boolean }) {
  const radio = useId();
  const [data, setData] = useState<Overview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState<"C" | "F">("C");
  const [night, setNight] = useState<Record<string, Mode | null>>({});

  useEffect(() => {
    try { if (window.localStorage.getItem(unitKey) === "F") setUnit("F"); } catch { /* browser preference is optional */ }
  }, []);

  const load = useCallback(async () => {
    try { setData(await request<Overview>()); setError(""); }
    catch (error) {
      setData(null);
      setError(error instanceof Error ? error.message : "Unable to read Blink settings.");
    }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);

  function changeUnit(next: "C" | "F") {
    setUnit(next);
    try { window.localStorage.setItem(unitKey, next); } catch { /* preference can remain in this view */ }
  }

  async function readNight(name: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ nightVision: Mode | null }>("?camera=" + encodeURIComponent(name));
      setNight((current) => ({ ...current, [name]: result.nightVision }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to check night vision.");
    } finally { setBusy(false); }
  }

  async function update(change: Change) {
    if (busy || (change.kind === "system" && !change.enabled &&
        !window.confirm("Disarm " + change.name + "? This can stop motion recording on its cameras."))) return;
    setBusy(true);
    setError("");
    try {
      await request("", change);
      if (change.kind === "nightVision") setNight((current) => ({ ...current, [change.name]: change.mode }));
      else await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Blink did not confirm the change.");
    } finally { setBusy(false); }
  }

  const showTemp = (value: number | null) => value === null ? "Unavailable" : (unit === "C" ? value : value * 1.8 + 32).toFixed(1) + " °" + unit;
  return <section className="card" aria-labelledby="blink-settings-title">
    <div className="section-head"><div><h2 id="blink-settings-title">Blink camera settings</h2></div>
      <button className="button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close settings" : "Open settings"}</button>
    </div>
    {open && <>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading Blink settings…</p>}
      {data && <>
        <fieldset className="section-head">
          <legend>Temperature unit</legend>
          {(["C", "F"] as const).map((value) => <label key={value}>
            <input type="radio" name={radio + "-unit"} checked={unit === value} onChange={() => changeUnit(value)} />
            {value === "C" ? " Celsius" : " Fahrenheit"}
          </label>)}
        </fieldset>
        {data.systems.map((system) => <div key={system.name} className="section-head">
          <div><h3>{system.name}</h3><p>{system.armed === null ? "Arm status unavailable" : system.armed ? "Armed" : "Disarmed"}</p></div>
          {owner && system.armed !== null && <button className="button" type="button" role="switch" aria-checked={system.armed} aria-label={"Arm " + system.name} disabled={busy} onClick={() => void update({ kind: "system", name: system.name, enabled: !system.armed })}>{system.armed ? "Disarm system" : "Arm system"}</button>}
        </div>)}
        <div className="grid2">{data.cameras.map((camera, index) => <article key={camera.name} className="card">
          <h3>{camera.name}</h3>
          <p>{[camera.model, camera.firmware ? "Firmware " + camera.firmware : null, camera.system].filter(Boolean).join(" · ")}</p>
          <dl>
            <dt>Camera temperature</dt><dd>{showTemp(camera.temperatureC)}</dd>
            <dt>Battery</dt><dd>{camera.battery ?? "Unavailable"}</dd>
            <dt>Wi-Fi signal</dt><dd>{camera.wifiSignal ?? "Unavailable"}</dd>
            <dt>Sync module signal</dt><dd>{camera.syncSignal ?? "Unavailable"}</dd>
            <dt>Motion</dt><dd>{camera.motionDetected === null ? "Unavailable" : camera.motionDetected ? "Detected" : "Clear"}</dd>
          </dl>
          {camera.motionEnabled === null ? <p>Motion detection setting unavailable.</p> : owner
            ? <button className="button" type="button" role="switch" aria-checked={camera.motionEnabled} aria-label={"Motion detection for " + camera.name} disabled={busy} onClick={() => void update({ kind: "motion", name: camera.name, enabled: !camera.motionEnabled })}>Motion detection {camera.motionEnabled ? "on" : "off"}</button>
            : <p>Motion detection {camera.motionEnabled ? "on" : "off"}</p>}
          {owner && (night[camera.name] === undefined
            ? <button className="button" type="button" disabled={busy} onClick={() => void readNight(camera.name)}>Check night vision</button>
            : night[camera.name] === null ? <p>Night vision control unavailable.</p>
            : <fieldset><legend>Night vision</legend>
              {(["auto", "on", "off"] as const).map((mode) => <label key={mode}>
                <input type="radio" name={radio + "-night-" + index} checked={night[camera.name] === mode} disabled={busy} onChange={() => void update({ kind: "nightVision", name: camera.name, mode })} />
                {" " + mode[0].toUpperCase() + mode.slice(1)}
              </label>)}
            </fieldset>)}
        </article>)}</div>
      </>}
    </>}
  </section>;
}
