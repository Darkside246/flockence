"use client";
import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";

type Batch = { id:string; name:string; traceCode:string; status:string; initialChicks:number };
type TraceItem = { stage:string; type:string; occurredAt:string; recordedAt?:string|null; recordId:string; source:string; quantity?:number|null; unit?:string|null; details:Record<string,any> };
type TraceData = {
 traceCode:string; batchId:string; batchName:string; status:string; initialChicks:number; lifecycleStart:string; actualSlaughter:string|null; eventCount:number;
 birdReconciliation:{initialChicks:number;mortality:number;slaughtered:number;condemned:number;accounted:number;unaccountedOrRemaining:number;balanced:boolean;note:string};
 sales:{lineCount:number;quantity:number;revenueMinor:number};
 inventory:{lots:number;availableQuantity:number};
 stages:{key:string;label:string;complete:boolean;count:number}[];
 items:TraceItem[];
};

const money=(n:number)=>new Intl.NumberFormat("en-BB",{style:"currency",currency:"BBD"}).format(n/100);
const date=(v:string)=>new Date(v).toLocaleString("en-BB",{dateStyle:"medium",timeStyle:"short"});
const label=(v:string)=>v.toLowerCase().replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());

export default function Trace(){
 const[batches,setBatches]=useState<Batch[]>([]); const[selected,setSelected]=useState(""); const[code,setCode]=useState(""); const[data,setData]=useState<TraceData|null>(null); const[error,setError]=useState(""); const[loading,setLoading]=useState(false);
 useEffect(()=>{fetch("/api/batches",{cache:"no-store"}).then(r=>r.json()).then((rows)=>{setBatches(Array.isArray(rows)?rows:[]);if(rows?.[0]){setSelected(rows[0].id);}}).catch(()=>setError("Could not load batches."))},[]);
 const load=async(idOrCode:string, mode:"batch"|"code")=>{setLoading(true);setError("");try{const q=mode==="batch"?"batchId="+encodeURIComponent(idOrCode):"code="+encodeURIComponent(idOrCode.trim());const r=await fetch("/api/trace?"+q,{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Trace not found.");setData(d)}catch(e){setData(null);setError(e instanceof Error?e.message:"Could not load trace.")}finally{setLoading(false)}};
 useEffect(()=>{if(selected)void load(selected,"batch")},[selected]);
 const groups=useMemo(()=>{const map=new Map<string,TraceItem[]>();for(const item of data?.items||[]){const arr=map.get(item.stage)||[];arr.push(item);map.set(item.stage,arr)}return [...map.entries()]},[data]);
 return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Trace</h1><p>End-to-end accountability from chick registration through harvest, product lots and sale.</p></div><span className="badge">FARMER TRACE</span></div></header><Nav/><main className="main">
 {error&&<section className="section card"><strong>{error}</strong></section>}
 <section className="section card"><div className="form grid2">
  <label>Batch<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.name} · {b.traceCode}</option>)}</select></label>
  <form onSubmit={e=>{e.preventDefault();if(code.trim())void load(code,"code")}} className="form"><label>Trace code<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Paste a trace code"/></label><button className="button">Open trace code</button></form>
 </div></section>
 {loading&&<section className="section card"><p>Loading trace...</p></section>}
 {data&&!loading&&<><section className="section"><div className="grid3">
  <article className="card"><span className="muted">Trace code</span><h2>{data.traceCode}</h2><p>{data.batchName}</p></article>
  <article className="card"><span className="muted">Bird reconciliation</span><h2>{data.birdReconciliation.accounted} / {data.initialChicks}</h2><p>{data.birdReconciliation.balanced?"Balanced":"Review variance"} · {data.birdReconciliation.note}</p></article>
  <article className="card"><span className="muted">Sales recorded</span><h2>{data.sales.lineCount}</h2><p>{money(data.sales.revenueMinor)} · {data.sales.quantity} product units</p></article>
 </div></section>
 <section className="section card"><div className="section-head"><div><h2>Trace stages</h2><p>Each stage points back to the original operational record. The trace does not require duplicate entry.</p></div><div className="quick"><button className="button" onClick={()=>window.print()}>Print trace</button><a className="action" href={`/api/trace?batchId=${encodeURIComponent(data.batchId)}&format=csv`}>Export CSV</a></div></div><div className="quick">{data.stages.map(s=><span key={s.key} className="badge">{s.complete?"✓ ":""}{s.label} · {s.count}</span>)}</div></section>
 <section className="section"><h2>Accountability timeline</h2>{groups.map(([stage,rows])=><div key={stage} className="section"><h3>{label(stage)}</h3><div className="list">{rows.map((x,i)=><article className="card" key={x.recordId+"-"+i}><div className="section-head"><div><strong>{label(x.type)}</strong><p className="muted">{x.source} · Record {x.recordId}</p></div><span className="badge">{date(x.occurredAt)}</span></div><div className="grid3"><div><strong>{x.quantity==null?"—":x.quantity}</strong><span>{x.unit||""}</span></div><div><strong>{x.recordedAt?date(x.recordedAt):"Source time not available"}</strong><span>entered in system</span></div><div><strong>{typeof x.details.entryLagHours==="number"?x.details.entryLagHours+" h":"—"}</strong><span>entry lag</span></div></div><p className="muted">{Object.entries(x.details).filter(([k])=>!["entryLagHours"].includes(k)).slice(0,8).map(([k,v])=>`${label(k)}: ${typeof v==="object"?JSON.stringify(v):String(v)}`).join(" · ")}</p></article>)}</div></div>)}</section>
 </>}
 </main></div>
}
