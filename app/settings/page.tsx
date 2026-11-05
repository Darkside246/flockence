"use client";

import { FormEvent, useEffect, useState } from "react";
import { FarmOperationForm } from "@/components/farm-operation";
import { RoundsSettings } from "@/components/rounds-settings";
import { DeviceSettings } from "@/components/device-settings";
import { Nav } from "@/components/nav";
import { useTheme } from "@/components/theme-provider";

type ThemeName = "crystal" | "aero" | "heritage" | "workhorse" | "sol" | "terra";
const themes: { id: ThemeName; name: string; desc: string; bg: string; accent: string }[] = [
  { id: "crystal", name: "Cyber Crystal", desc: "Obsidian glass with cyber-teal light", bg: "linear-gradient(135deg,#050a12,#10283a)", accent: "#35e0d0" },
  { id: "aero", name: "Aero Glass", desc: "Dark glass with cyan highlights", bg: "linear-gradient(135deg,#070b12,#0f172a)", accent: "#00f2fe" },
  { id: "heritage", name: "Heritage Sovereign", desc: "Deep green with brass accents", bg: "linear-gradient(135deg,#0e1210,#1c2821)", accent: "#e5c378" },
  { id: "workhorse", name: "Field Workhorse", desc: "High-contrast industrial amber", bg: "linear-gradient(135deg,#141618,#303438)", accent: "#ffb703" },
  { id: "sol", name: "Sol Tactical", desc: "Maximum-contrast black and yellow", bg: "linear-gradient(135deg,#000000,#1a1a1a)", accent: "#ffe500" },
  { id: "terra", name: "Terra Flora", desc: "Warm earth with soft green", bg: "linear-gradient(135deg,#171412,#2c2723)", accent: "#86efac" }
];

export default function SettingsPage(){
  const [farmName,setFarmName]=useState("Alchemy Farms");
  const [feedPrice,setFeedPrice]=useState("56");
  const [chickCost,setChickCost]=useState("2.90");
  const [slaughter,setSlaughter]=useState("2.00");
  const [weatherName,setWeatherName]=useState("");
  const [weatherLat,setWeatherLat]=useState("");
  const [weatherLon,setWeatherLon]=useState("");
  const [loaded,setLoaded]=useState(false), [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const { theme, density, radius, setTheme, setDensity, setRadius } = useTheme();

  useEffect(()=>{fetch("/api/settings").then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{setFarmName(d.farm?.name||"Alchemy Farms");const map=Object.fromEntries((d.settings||[]).map((x:{key:string,value:string})=>[x.key,x.value]));setFeedPrice(map.default_feed_bag_price||"56");setChickCost(map.default_chick_cost||"2.90");setSlaughter(map.default_slaughter_cost||"2.00");setWeatherName(map.weather_location_name||"");setWeatherLat(map.weather_latitude||"");setWeatherLon(map.weather_longitude||"");setLoaded(true)}).catch(()=>setMessage("Settings could not be loaded."))},[]);
  async function save(e:FormEvent){e.preventDefault();if(!loaded || saving)return;setSaving(true);setMessage("");try {const r=await fetch("/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({farmName,settings:[{key:"default_feed_bag_price",value:feedPrice},{key:"default_chick_cost",value:chickCost},{key:"default_slaughter_cost",value:slaughter},{key:"weather_location_name",value:weatherName},{key:"weather_latitude",value:weatherLat},{key:"weather_longitude",value:weatherLon}]})});if(!r.ok)throw Error();setMessage("Farm settings saved.");} catch {setMessage("Could not save farm settings. Try again.");} finally {setSaving(false);}}

  return <div className="shell">
    <header className="topbar"><div className="brand"><div className="brand-main"><div className="brand-mark">F</div><div><h1>Settings</h1><p>Control the way Flockence looks and works.</p></div></div><span className="badge">CONTROL CENTER</span></div></header>
    <Nav/>
    <main className="main">
      <FarmOperationForm/>
      <details className="section card settings-group"><summary>Farm details, costs and weather</summary>      <form className="section card form grid2" onSubmit={save}><div className="section-head" style={{gridColumn:"1/-1"}}><div><h3>Farm configuration</h3><p>Farm identity and production defaults.</p></div><span className="badge">CONFIGURATION</span></div>
<label>Farm name<input value={farmName} onChange={e=>setFarmName(e.target.value)}/></label><label>Default feed bag price BBD<input type="number" step="0.01" value={feedPrice} onChange={e=>setFeedPrice(e.target.value)}/></label><label>Default chick cost BBD<input type="number" step="0.01" value={chickCost} onChange={e=>setChickCost(e.target.value)}/></label><label>Default slaughter cost BBD<input type="number" step="0.01" value={slaughter} onChange={e=>setSlaughter(e.target.value)}/></label>
      <section className="section card"><div className="section-head"><div><h3>Farm weather location</h3><p>Enter the farm location once. Flockence uses it for live weather and heat watches.</p></div><span className="badge">WEATHER</span></div><div className="grid2"><label>Location name<input value={weatherName} onChange={e=>setWeatherName(e.target.value)} placeholder="Farm / community"/></label><label>Latitude<input value={weatherLat} onChange={e=>setWeatherLat(e.target.value)} type="number" step="0.000001" placeholder="13.000000"/></label><label>Longitude<input value={weatherLon} onChange={e=>setWeatherLon(e.target.value)} type="number" step="0.000001" placeholder="-59.000000"/></label><div><p className="muted">Weather comes from a server-side provider. The API key is never stored in farm settings or sent to the browser.</p></div></div></section>
<div><button className="button button-primary" type="submit" disabled={!loaded || saving}>{saving ? "Saving..." : "Save farm settings"}</button>{message&&<span className="notice">{message}</span>}</div></form>
</details>
      <DeviceSettings/>
      <details className="section card settings-group"><summary>Notifications and Daily Rounds</summary><RoundsSettings/></details>
      <details className="section card settings-group"><summary>Appearance</summary>      <section className="section card"><div className="section-head"><div><h3>Visual style</h3><p>Six built-in looks for different work environments.</p></div></div><div className="theme-grid">{themes.map(t=><button type="button" key={t.id} className={`theme-option ${theme===t.id?"selected":""}`} onClick={()=>setTheme(t.id)} aria-pressed={theme===t.id}><div className="theme-swatch" style={{background:t.bg}}><div style={{width:20,height:20,borderRadius:7,background:t.accent,margin:12}}/></div><span className="theme-name">{t.name}</span><span className="theme-desc">{t.desc}</span></button>)}</div></section>
      <section className="section card"><div className="section-head"><div><h3>Interface feel</h3><p>Adjust how much information fits on screen.</p></div></div><div className="grid2"><div><label>Information density</label><div className="segmented"><button className={density==="comfortable"?"selected":""} type="button" onClick={()=>setDensity("comfortable")}>Comfortable</button><button className={density==="compact"?"selected":""} type="button" onClick={()=>setDensity("compact")}>Compact</button></div></div><div><label>Card shape</label><div className="segmented"><button className={radius==="soft"?"selected":""} type="button" onClick={()=>setRadius("soft")}>Soft</button><button className={radius==="sharp"?"selected":""} type="button" onClick={()=>setRadius("sharp")}>Sharp</button></div></div></div></section>
</details>
      <a className="button" href="/account">Account and security</a>
    </main>
  </div>
}
