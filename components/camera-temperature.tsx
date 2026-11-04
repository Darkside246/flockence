"use client";
import {useEffect,useState} from "react";
import {useSession} from "./auth-gate";
type Reading={sensor:string;temperatureC:string;readAt:string};
export function useCameraTemperature(camera:string,temperatureF:number|string|null|undefined,blink:boolean){
  const user=useSession();
  const key=user?JSON.stringify(["camera-temperature",user.farmId,user.id,camera]):"";
  const [source,setSource]=useState(""),[open,setOpen]=useState(false),[rows,setRows]=useState<Reading[]>([]),[failed,setFailed]=useState(false);
  useEffect(()=>{try{setSource(key?localStorage.getItem(key)??"":"");}catch{setSource("");}},[key]);
  useEffect(()=>{
    if(!key || (!open && !source.startsWith("sensor:")))return;
    const controller=new AbortController();
    async function load(){try {
      const r=await fetch("/api/camera-temperatures",{signal:controller.signal,cache:"no-store"});
      if(!r.ok)throw Error();
      const data:Reading[]=await r.json();if(!controller.signal.aborted){setRows(data);setFailed(false);}
    }catch{if(!controller.signal.aborted)setFailed(true);}}
    void load();const timer=setInterval(load,60000);
    return ()=>{clearInterval(timer);controller.abort();};
  },[key,source,open]);
  const selected=rows.find(r=>"sensor:"+r.sensor===source);
  const raw=temperatureF==null || String(temperatureF).trim()===""?NaN:Number(temperatureF);
  const value=source==="blink"?(raw-32)*5/9:selected?Number(selected.temperatureC):NaN;
  const stale=!!selected && Date.now()-Date.parse(selected.readAt)>15*60000;
  const badge=source && <span className="camera-temp-badge" title={source==="blink"?"Last temperature reported by Blink":selected?selected.sensor+" · "+new Date(selected.readAt).toLocaleString():source.slice(7)}>
    {Number.isFinite(value)?value.toFixed(1)+" °C"+(stale||failed&&source!=="blink"?" · last read":""):"Temp —"}
  </span>;
  const settings=<details className="camera-temp-settings" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Temperature overlay</summary>
    <label>Reading for {camera}<select value={source} onChange={e=>{const next=e.target.value;setSource(next);try{if(key)localStorage.setItem(key,next);}catch{}}}>
    <option value="">Off</option>{blink && <option value="blink">Blink camera temperature</option>}
    {source.startsWith("sensor:")&&!selected && <option value={source}>{source.slice(7)} · unavailable</option>}
    {rows.map(r=><option key={r.sensor} value={"sensor:"+r.sensor}>{r.sensor}</option>)}</select></label>
    {failed && <small>Farm thermometer readings could not be refreshed.</small>}</details>;
  return {badge,settings};
}
