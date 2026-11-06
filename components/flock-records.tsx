"use client";
import { FormEvent,useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
type Batch={id:string;name:string;initialChicks:number;status:string;productionType?:string|null;species?:string};
const today=()=>calendarDateInTimeZone(new Date())??new Date().toISOString().slice(0,10);
async function post(path:string,data:unknown){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not save");return d}

/** Weights and deaths for the flocks being checked today. One canonical place to record each. */
export function FlockRecords({batches,onSaved}:{batches:Batch[];onSaved?:()=>void}){
 const[msg,setMsg]=useState("");
 const[weightBatchId,setWeightBatchId]=useState("");const[weightType,setWeightType]=useState("LIVE");
 const selectedWeightBatch=batches.find(b=>b.id===weightBatchId);
 const isLayerWeightBatch=selectedWeightBatch?.productionType==="LAYER"||String(selectedWeightBatch?.species||"").toUpperCase()==="LAYER";
 if(isLayerWeightBatch&&weightType==="DRESSED")setWeightType("LIVE");
 async function submit(e:FormEvent<HTMLFormElement>,path:string,build:(f:FormData)=>unknown){e.preventDefault();const form=e.currentTarget;setMsg("");try{await post(path,build(new FormData(form)));form.reset();setMsg("Saved. The record is now part of the farm's operational history.");onSaved?.()}catch(e){setMsg(e instanceof Error?e.message:"Could not save")}}
 return <section className="section"><h2>Weights and deaths</h2>
 {msg&&<div className="card" role="status"><strong>{msg}</strong></div>}
 <div className="grid2">
 <form className="card form" onSubmit={e=>submit(e,"/api/weights",f=>({batchId:f.get("batchId"),date:f.get("date"),quantity:Number(f.get("quantity")),avgWeightKg:Number(f.get("avgWeightKg")),scope:f.get("scope"),liveOrDressed:f.get("liveOrDressed")}))}><h3>Record weight</h3><label>Batch<select name="batchId" value={weightBatchId} onChange={e=>setWeightBatchId(e.target.value)} required><option value="">Select batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Date<input name="date" type="date" defaultValue={today()} max={today()}/></label><label>Birds weighed<input name="quantity" type="number" min="1" required/></label><label>Average weight kg<input name="avgWeightKg" type="number" min="0.01" step="0.001" required/></label><label>Scope<select name="scope"><option>SAMPLE</option><option>INDIVIDUAL</option><option>BATCH_AVERAGE</option></select></label><label>Weight type<select name="liveOrDressed" value={weightType} onChange={e=>setWeightType(e.target.value)}><option value="LIVE">Live weight</option>{!isLayerWeightBatch&&<option value="DRESSED">Dressed weight</option>}</select></label><button className="button">Record weight</button></form>
 <form className="card form" onSubmit={e=>submit(e,"/api/mortality",f=>({batchId:f.get("batchId"),date:f.get("date"),quantity:Number(f.get("quantity")),reason:f.get("reason"),notes:f.get("notes")}))}><h3>Birds died</h3><label>Batch<select name="batchId" required><option value="">Select batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Date<input name="date" type="date" defaultValue={today()} max={today()}/></label><label>Number<input name="quantity" type="number" min="1" required/></label><label>Reason<input name="reason" placeholder="Optional"/></label><button className="button">Record mortality</button></form>
 </div></section>
}
