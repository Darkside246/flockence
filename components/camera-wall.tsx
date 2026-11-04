"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LiveView } from "./camera-live-view";
import { api, enc, json } from "@/lib/camera-client";
import { visibleSlots } from "@/lib/camera-slots.mjs";

export type CameraWallStatus = { state:"loading"|"unavailable"|"ready"; count:number; message?:string };
type Camera = { name:string; source:"blink"|"rtsp"; battery?:string|number|null; recording?:boolean };
const automatic: (string|null)[] = [null,null,null,null];

function CameraTile({camera,ffmpeg,refresh}: {camera:Camera;ffmpeg:boolean;refresh:number}) {
  const [stamp,setStamp] = useState(0), [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  const [image,setImage] = useState({url:"",loaded:"",failed:false});
  const path = api("cameras/"+enc(camera.name)+"/snapshot");
  const url = path+"?t="+refresh+"-"+stamp;
  async function takePhoto() {
    setBusy(true);setMessage("");
    try {
      const r = await fetch(path+"?fresh=true&t="+Date.now(),{cache:"no-store"});
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image/")) throw new Error("Could not capture a fresh photo ("+r.status+").");
      const objectUrl = URL.createObjectURL(await r.blob());
      const link = document.createElement("a");
      link.href=objectUrl;link.download=camera.name+"-"+Date.now()+".jpg";link.click();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);
      setStamp(Date.now());setMessage("Photo captured. Download requested.");
    } catch(e){setMessage(e instanceof Error ? e.message : "Photo failed.");}
    finally {setBusy(false);}
  }
  return <>
    <LiveView camera={camera.name} source={camera.source} compact ffmpeg={ffmpeg}>
      {image.url===url && image.failed ? <div className="cx-cam-offline"><div>No picture available</div></div> :
        <img key={url} src={url} className={image.url===url && image.loaded ? "is-loaded" : ""} alt={camera.name}
          onLoad={()=>setImage({url,loaded:new Date().toLocaleTimeString(),failed:false})} onError={()=>setImage({url,loaded:"",failed:true})} />}
      <div className="cx-cam-top"><span>{camera.name}</span><span className="cx-tag">{camera.source}</span></div>
      <div className="cx-cam-bottom"><span className="cx-tag">{image.url===url && image.failed ? "Unavailable" : "Still "+(image.url===url?image.loaded:"")}</span>
        {camera.battery != null && <span className="cx-tag">Battery {camera.battery}</span>}
        {camera.recording && <span className="cx-tag">Recording</span>}</div>
    </LiveView>
    <div className="cx-camera-actions"><button type="button" className="button" disabled={busy} onClick={takePhoto}>Take photo</button>
      <button type="button" className="button" onClick={()=>setStamp(Date.now())}>Update image</button></div>
    {message && <small role="status">{message}</small>}
  </>;
}

export function CameraWall({onStatus}: {onStatus?:(s:CameraWallStatus)=>void}) {
  const [cams,setCams]=useState<Camera[]>([]),[slots,setSlots]=useState(automatic),[error,setError]=useState("");
  const [saving,setSaving]=useState(false),[loading,setLoading]=useState(true),[ffmpeg,setFfmpeg]=useState(false),[refresh,setRefresh]=useState(0);
  const load=useCallback(async()=>{
    setLoading(true);
    try {
      const [c,s,config]=await Promise.all([json<Camera[]>(api("cameras")),json<(string|null)[]>("/api/camera-wall"),json<{ffmpeg:boolean}>(api("status"))]);
      setCams(c);setSlots(s);setFfmpeg(config.ffmpeg);setError("");setRefresh(Date.now());onStatus?.({state:"ready",count:c.length});
    } catch(e){const message=e instanceof Error?e.message:"Cameras unavailable.";setError(message);onStatus?.({state:"unavailable",count:0,message});}
    finally{setLoading(false);}
  },[onStatus]);
  useEffect(()=>{void load();},[load]);
  // Discover newly registered cameras without reloading the thumbnails or player.
  useEffect(() => {
    if (!refresh) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const list = await json<Camera[]>(api("cameras"), {signal:controller.signal,cache:"no-store"});
        if (!controller.signal.aborted) { setCams(list); onStatus?.({state:"ready",count:list.length}); }
      } catch { /* Explicit Refresh exposes any connection error. */ }
    }, 30000);
    return () => {controller.abort();clearInterval(timer);};
  },[refresh,onStatus]);
  const shown=visibleSlots(slots,cams.map(c=>c.name));
  async function choose(i:number,name:string) {
    const next=[...slots];const previous=next.indexOf(name);
    if(name && previous>=0 && previous!==i) next[previous]=slots[i];
    next[i]=name||null;setSaving(true);
    try {setSlots(await json<(string|null)[]>("/api/camera-wall",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)}));setError("");}
    catch(e){setError(e instanceof Error?e.message:"Layout could not be saved.");}finally{setSaving(false);}
  }
  return <section><div className="cx-section-head"><div><div className="hero-kicker">Surveillance</div><h3>Cameras</h3></div>
    <button className="button" disabled={saving||loading} onClick={load}>Refresh cameras</button><Link className="button" href="/cameras#camera-settings">Camera settings</Link><Link className="button" href="/cameras">All cameras</Link></div>
    {error && <p role="alert">{error}</p>}
    <div className="cx-cams">{shown.map((name,i)=>{
      const camera=cams.find(c=>c.name===name);
      return <article key={i} style={{minWidth:0}}>
      <label>Camera {i+1}<select disabled={loading||saving||!refresh} value={slots[i]||""} onChange={e=>choose(i,e.target.value)}>
        <option value="">Automatic</option>{slots[i] && !cams.some(c=>c.name===slots[i]) && <option>{slots[i]}</option>}
        {cams.map(c=><option key={c.name}>{c.name}</option>)}</select></label>
      {camera ? <CameraTile key={camera.name} camera={camera} ffmpeg={ffmpeg} refresh={refresh}/> :
        <div className="card cx-cam"><div className="cx-cam-offline"><div>{loading ? "Loading cameras…" : slots[i] ? "Assigned camera unavailable" : "Available camera space"}<p>{slots[i] ? "Choose another camera or leave it assigned." : "New cameras fill automatic slots."}</p></div></div></div>}
    </article>})}</div></section>;
}
