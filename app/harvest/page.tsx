"use client";
import { FormEvent,useEffect,useState } from "react";
import { Nav } from "@/components/nav";
import { ProcessingPack } from "@/components/processing-pack";
import { ManurePanel } from "@/components/manure-panel";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
type Batch={id:string;name:string;initialChicks:number;status:string;productionType?:string|null;species?:string};
type SlaughterEvent={id:string;batchId:string;date:string;slaughtered:number;sentQuantity:number;condemned:number};
type TransportEvent={id:string;type:string;departureAt:string;arrivalAt?:string|null;origin?:string|null;destination?:string|null;carrier?:string|null;vehicle?:string|null;driverName?:string|null;birdsLoaded?:number|null;birdsArrived?:number|null;birdsDeadOnArrival:number;journeyMinutes?:number|null;distanceKm?:string|number|null;ambientTempC?:string|number|null;waterAvailable?:boolean|null;welfareCheckCompleted:boolean;sanitationCompleted:boolean;notes?:string|null;batch?:{id:string;name:string}|null;slaughterEvent?:SlaughterEvent|null};
const today=()=>calendarDateInTimeZone(new Date())??new Date().toISOString().slice(0,10);
async function post(path:string,data:unknown){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not save");return d}
const list=async(url:string)=>{const r=await fetch(url,{cache:"no-store"});const d=await r.json();if(!r.ok||!Array.isArray(d))throw new Error("Could not load "+url);return d};

export default function HarvestAndProcessing(){
 const[batches,setBatches]=useState<Batch[]>([]);const[slaughterEvents,setSlaughterEvents]=useState<SlaughterEvent[]>([]);const[msg,setMsg]=useState("");
 const broilerBatches=batches.filter(b=>b.productionType!=="LAYER"&&String(b.species||"").toUpperCase()!=="LAYER");
 useEffect(()=>{Promise.all([list("/api/batches"),list("/api/slaughter")]).then(([b,s])=>{setBatches(b);setSlaughterEvents(s)}).catch(()=>setMsg("Could not load harvest records."))},[]);
 async function submit(e:FormEvent<HTMLFormElement>,path:string,build:(f:FormData)=>unknown){e.preventDefault();const form=e.currentTarget;setMsg("");try{await post(path,build(new FormData(form)));form.reset();setMsg("Saved. The record is now part of the farm's operational history.");try{setSlaughterEvents(await list("/api/slaughter"))}catch{setMsg("Saved, but the slaughter list could not refresh. Reload to confirm the latest dispatch.")}}catch(e){setMsg(e instanceof Error?e.message:"Could not save")}}
 return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Harvest and processing</h1><p>Record slaughter, pack the processed birds and account for by-products.</p></div></div></header><Nav/><main className="main">
 {msg&&<section className="section card" role="status"><strong>{msg}</strong></section>}
 <section className="section"><h2>Slaughter and processing</h2><div className="grid2">
 <form className="card form" onSubmit={e=>submit(e,"/api/slaughter",f=>({batchId:f.get("batchId"),date:f.get("date"),sentQuantity:Number(f.get("sentQuantity")),slaughtered:Number(f.get("slaughtered")),condemned:Number(f.get("condemned")||0),slaughterCostMinor:Math.round(Number(f.get("slaughterCost"))*Number(f.get("slaughtered"))*100),liveWeightKg:f.get("liveWeightKg")?Number(f.get("liveWeightKg")):null,dressedWeightKg:f.get("dressedWeightKg")?Number(f.get("dressedWeightKg")):null,chillingCompletedAt:f.get("chillingCompletedAt")||null,notes:f.get("notes")}))}><h3>Slaughter event</h3><label>Batch<select name="batchId" required><option value="">Select batch</option>{broilerBatches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Date<input name="date" type="date" defaultValue={today()} max={today()}/></label><label>Birds sent<input name="sentQuantity" type="number" min="1" required/></label><label>Birds slaughtered<input name="slaughtered" type="number" min="0" required/></label><label>Condemned<input name="condemned" type="number" min="0" defaultValue="0"/></label><label>Total live weight kg<input name="liveWeightKg" type="number" min="0" step="0.001"/></label><label>Total dressed weight kg<input name="dressedWeightKg" type="number" min="0" step="0.001"/></label><label>Slaughter cost / bird BBD<input name="slaughterCost" type="number" min="0" step="0.01" defaultValue="2.00"/></label><label>Chilling completed<input name="chillingCompletedAt" type="datetime-local"/></label><label>Notes<textarea name="notes"/></label><button className="button">Record slaughter</button></form>
 <ProcessingPack batches={broilerBatches} slaughterEvents={slaughterEvents}/>
 </div></section>
 <section className="section"><h2>By-products</h2><div className="grid2"><ManurePanel batches={batches}/><div className="card"><h3>Use the bird completely</h3><p className="muted">Flockence treats carcass, giblets, feet, cuts, waste and manure as separate outputs so the farmer can see value recovered from the whole production batch.</p></div></div></section>
 </main></div>
}
