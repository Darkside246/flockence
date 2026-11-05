"use client";
import {useEffect,useState} from "react";
type Reading={name:string;temperatureC:number|null;humidityPercent:number|null;readAt:string|null};
export function PenEnvironment(){
  const [rows,setRows]=useState<Reading[]>([]),[unit,setUnit]=useState("C"),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){try{
      const response=await fetch("/api/environment-readings",{cache:"no-store",signal:controller.signal});
      if(!response.ok)throw Error();
      const data=await response.json();
      if(!controller.signal.aborted){setRows(data);setFailed(false);}
    }catch{if(!controller.signal.aborted)setFailed(true);}}
    void load();const timer=setInterval(load,60000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[]);
  return <section className="section card"><div className="section-head"><h2>Pen temperature and humidity</h2>
    <label>Units<select value={unit} onChange={e=>setUnit(e.target.value)}><option value="C">°C</option><option value="F">°F</option></select></label></div>
    {failed&&<p role="alert">Could not refresh readings. Showing the last available values.</p>}
    <div className="sensor-readings">{rows.map(row=>{
      const stale=!row.readAt||Date.now()-Date.parse(row.readAt)>15*60000;
      return <article className="sensor-reading" key={row.name}><h3>{row.name}</h3><div className="sensor-values">
        <div><span>Temperature</span><strong>{row.temperatureC==null?"—":(unit==="F"?row.temperatureC*9/5+32:row.temperatureC).toFixed(1)+" °"+unit}</strong></div>
        <div><span>Humidity</span><strong>{row.humidityPercent==null?"—":row.humidityPercent.toFixed(1)+"%"}</strong></div>
      </div><p>{stale?"Awaiting a fresh reading · ":""}{row.readAt?new Date(row.readAt).toLocaleTimeString():"No reading yet"}</p></article>;
    })}{Array.from({length:Math.max(0,6-rows.length)},(_,i)=><a className="sensor-reading sensor-placeholder" key={"empty"+i} href="/settings#sensor-settings">Add sensor {rows.length+i+1}</a>)}</div>
    <a href="/settings#sensor-settings">Manage sensors and pen names</a>
  </section>;
}
