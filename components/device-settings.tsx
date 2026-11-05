"use client";
import { useEffect, useState } from "react";
import { useSession } from "./auth-gate";
import { CameraSetup, type Camera, type CameraStatus } from "./camera-setup";
import { api, json } from "@/lib/camera-client";

type Device = {device:string;sku:string;label:string;temperature?:boolean;type?:string};
type Sensor = {device:string;sku:string;name:string;unit:string};
type Result = {monitoring?:boolean;equipment?:Device[];state?:{name:string;value:unknown}[];connected?:boolean;sensors?:Sensor[];devices?:Device[];reading?:{temperatureC:number;humidityPercent:number|null;readAt:string}|null};

function Thermometers() {
  const [provider,setProvider]=useState(""), [key,setKey]=useState(""), [connected,setConnected]=useState(false);
  const [equipment,setEquipment]=useState<Device[]>([]);
  const [devices,setDevices]=useState<Device[]>([]), [sensors,setSensors]=useState<Sensor[]>([]);
  const [device,setDevice]=useState(""), [name,setName]=useState(""), [unit,setUnit]=useState("");
  const [message,setMessage]=useState(""), [busy,setBusy]=useState(false);
  const [monitoring,setMonitoring]=useState<boolean|null>(null);
  function apply(result:Result) {
    if(result.connected!==undefined) {setConnected(result.connected); if(result.connected)setProvider("Govee");}
    if(result.monitoring!==undefined)setMonitoring(result.monitoring);
    if(result.equipment)setEquipment(result.equipment);
    if(result.sensors)setSensors(result.sensors);
    if(result.devices)setDevices(result.devices);
  }
  useEffect(()=>{json<Result>("/api/device-settings").then(apply).catch(()=>setMessage("Could not load device settings."));},[]);
  async function action(action:string, selected=device) {
    setBusy(true);setMessage("");
    try {
      const result=await json<Result>("/api/device-settings",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action,enabled:action==="monitoring"?!monitoring:undefined,key:action==="connect"?key:undefined,device:selected,name,unit})});
      apply(result);
      if(action==="monitoring")setMessage(result.monitoring ? "Scheduled temperature collection enabled." : "Scheduled temperature collection paused.");
      else if(action==="state")setMessage(result.state?.map(c=>c.name+" · "+(typeof c.value==="object"?JSON.stringify(c.value):String(c.value))).join(" | ") || "No current state reported.");
      else if(action==="equipment")setMessage("Device saved for this farm.");
      else if(action==="read") setMessage(result.reading ? result.reading.temperatureC+" °C"+(result.reading.humidityPercent==null?"":" · "+result.reading.humidityPercent+"% humidity")+" · "+new Date(result.reading.readAt).toLocaleString() : "Sensor offline or no current reading.");
      else if(action==="disconnect"){setEquipment([]);setSensors([]);setDevices([]);setDevice("");setKey("");setMessage("Govee disconnected.");}
      else if(action==="select")setMessage("Sensor saved for this farm.");
      else {setKey("");setDevice("");setMessage(result.devices?.length ? "Choose equipment below." : "Connected. This account exposes no devices through the API.");}
    } catch(e){setMessage(e instanceof Error?e.message:"Request failed.");} finally {setBusy(false);}
  }
  function choose(id:string) {
    setDevice(id);
    const saved=sensors.find(s=>s.device===id);
    setName(saved?.name ?? devices.find(d=>d.device===id)?.label ?? "");
    setUnit(saved?.unit ?? "");
  }
  return <section className="section card"><h2>Smart equipment and temperature sensors</h2>
    <label>Provider<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="">Choose a provider</option><option>Govee</option></select></label>
    {provider && <fieldset disabled={busy}><label>{connected?"Replace Govee API key":"Govee API key"}<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)}/></label>
      <button className="button" disabled={!key.trim()} onClick={()=>action("connect")}>Test and save key</button>
      {connected && <><button className="button" onClick={()=>action("discover")}>Discover devices</button>
      <button className="button button-danger" onClick={()=>{if(confirm("Disconnect Govee and stop collecting from these sensors?"))void action("disconnect");}}>Disconnect</button></>}
      {!!devices.length && <><label>Govee equipment<select value={device} onChange={e=>choose(e.target.value)}><option value="">Choose a device</option>{devices.map(d=><option key={d.device} value={d.device}>{d.label} · {d.sku} · {d.device}</option>)}</select></label>
      {device && <button className="button" onClick={()=>action("equipment")}>Save equipment</button>}
      {devices.find(d=>d.device===device)?.temperature && <><label>Sensor name<input value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label>
      <label>Temperature unit reported by device<select value={unit} onChange={e=>setUnit(e.target.value)}><option value="">Choose unit</option><option value="C">Celsius</option><option value="F">Fahrenheit</option></select></label>
      <button className="button" disabled={!unit||!name.trim()} onClick={()=>action("select")}>Save sensor</button></>}</>}
      {sensors.length>0 && monitoring!==null && <div><h3>Scheduled temperature monitoring</h3>
        <p>The farm sensor collector must be running to collect readings.</p>
        <button type="button" className="button" role="switch" aria-label="Scheduled temperature monitoring" aria-checked={monitoring} disabled={busy}
          onClick={()=>action("monitoring")}>{busy ? "Working…" : monitoring ? "On · Turn off" : "Off · Turn on"}</button>
      </div>}
      {equipment.map(d=><p key={d.device}>{d.label} · {d.sku} <button className="button" onClick={()=>action("state",d.device)}>Read device state</button></p>)}
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
  const [cameraOpen,setCameraOpen]=useState(false);
  useEffect(()=>{setCameraOpen(window.location.hash === "#camera-settings");},[]);
  return useSession()?.role==="OWNER" ? <><details className="section card settings-group"><summary>Equipment, sensors and integrations</summary><Thermometers/></details><details id="camera-settings" className="section card settings-group" open={cameraOpen} onToggle={event=>setCameraOpen(event.currentTarget.open)}><summary>Camera settings</summary><SettingsCameras/></details></> : <section className="card"><h2>Farm devices</h2><p>The farm owner manages device credentials.</p></section>;
}
