"use client";
import { useEffect, useState } from "react";
import { useSession } from "./auth-gate";
import { CameraSetup, type Camera, type CameraStatus } from "./camera-setup";
import { api, json } from "@/lib/camera-client";

type Device = {device:string;sku:string;label:string};
type Sensor = {device:string;sku:string;name:string;unit:string};
type Result = {connected?:boolean;sensors?:Sensor[];devices?:Device[];reading?:{temperatureC:number;humidityPercent:number|null;readAt:string}|null};

function Thermometers() {
  const [provider,setProvider]=useState(""), [key,setKey]=useState(""), [connected,setConnected]=useState(false);
  const [devices,setDevices]=useState<Device[]>([]), [sensors,setSensors]=useState<Sensor[]>([]);
  const [device,setDevice]=useState(""), [name,setName]=useState(""), [unit,setUnit]=useState("");
  const [message,setMessage]=useState(""), [busy,setBusy]=useState(false);
  function apply(result:Result) {
    if(result.connected!==undefined) {setConnected(result.connected); if(result.connected)setProvider("Govee");}
    if(result.sensors)setSensors(result.sensors);
    if(result.devices)setDevices(result.devices);
  }
  useEffect(()=>{json<Result>("/api/device-settings").then(apply).catch(()=>setMessage("Could not load device settings."));},[]);
  async function action(action:string, selected=device) {
    setBusy(true);setMessage("");
    try {
      const result=await json<Result>("/api/device-settings",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action,key:action==="connect"?key:undefined,device:selected,name,unit})});
      apply(result);
      if(action==="read") setMessage(result.reading ? result.reading.temperatureC+" °C"+(result.reading.humidityPercent==null?"":" · "+result.reading.humidityPercent+"% humidity")+" · "+new Date(result.reading.readAt).toLocaleString() : "Sensor offline or no current reading.");
      else if(action==="disconnect"){setDevices([]);setDevice("");setKey("");setMessage("Govee disconnected.");}
      else if(action==="select")setMessage("Sensor saved for this farm.");
      else {setKey("");setDevice("");setMessage(result.devices?.length ? "Choose a temperature sensor below." : "Connected. This account exposes no supported temperature sensors.");}
    } catch(e){setMessage(e instanceof Error?e.message:"Request failed.");} finally {setBusy(false);}
  }
  function choose(id:string) {
    setDevice(id);
    const saved=sensors.find(s=>s.device===id);
    setName(saved?.name ?? devices.find(d=>d.device===id)?.label ?? "");
    setUnit(saved?.unit ?? "");
  }
  return <section className="section card"><h2>Smart temperature devices</h2>
    <label>Provider<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="">Choose a provider</option><option>Govee</option></select></label>
    {provider && <fieldset disabled={busy}><label>{connected?"Replace Govee API key":"Govee API key"}<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)}/></label>
      <button className="button" disabled={!key.trim()} onClick={()=>action("connect")}>Test and save key</button>
      {connected && <><button className="button" onClick={()=>action("discover")}>Discover sensors</button>
      <button className="button" onClick={()=>{if(confirm("Disconnect Govee and stop collecting from these sensors?"))void action("disconnect");}}>Disconnect</button></>}
      {!!devices.length && <><label>Temperature sensor<select value={device} onChange={e=>choose(e.target.value)}><option value="">Choose a device</option>{devices.map(d=><option key={d.device} value={d.device}>{d.label} · {d.sku} · {d.device}</option>)}</select></label>
      {device && <><label>Sensor name<input value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label>
      <label>Temperature unit reported by device<select value={unit} onChange={e=>setUnit(e.target.value)}><option value="">Choose unit</option><option value="C">Celsius</option><option value="F">Fahrenheit</option></select></label>
      <button className="button" disabled={!unit||!name.trim()} onClick={()=>action("select")}>Save sensor</button></>}</>}
      {sensors.map(s=><p key={s.device}>{s.name} · {s.sku} <button className="button" onClick={()=>action("read",s.device)}>Read now</button></p>)}</fieldset>}
    {message && <p role="status">{message}</p>}</section>;
}
function SettingsCameras(){
  const [status,setStatus]=useState<CameraStatus|null>(null),[cams,setCams]=useState<Camera[]>([]),[error,setError]=useState("");
  async function load() {
    try {const status=await json<CameraStatus>(api("status"));setStatus(status);setCams(await json<Camera[]>(api("cameras")));setError("");}
    catch(e){setError(e instanceof Error?e.message:"Camera service unavailable.");}
  }
  useEffect(()=>{void load();},[]);
  return <><CameraSetup status={status} cameras={cams} onChange={load}/>{error && <p role="alert">{error} <button className="button" onClick={load}>Retry</button></p>}</>;
}
export function DeviceSettings(){
  return useSession()?.role==="OWNER" ? <><Thermometers/><SettingsCameras/></> : <section className="card"><h2>Farm devices</h2><p>The farm owner manages device credentials.</p></section>;
}
