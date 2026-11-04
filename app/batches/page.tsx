"use client";
import { useEffect,useState } from "react";
import { Nav } from "@/components/nav";

type Batch={id:string;name:string;startDate:string;liveBirdCount?:number;productionType?:string|null;layerStage?:string|null;species?:string;breed?:string|null;strain?:string|null;sex?:string|null;hatchery?:string|null;sourceLot?:string|null;placementQuality?:string|null;hatchDate?:string|null;purchaseDate?:string|null;expectedSlaughter?:string|null;targetSlaughterAgeDays:number;slaughterDecisionMode:string;targetLiveWeightKg?:number|null;status:string;initialChicks:number;chickCostMinor:number;mortalityEvents:{quantity:number}[];birdCounts?:{liveCount:number}[]};

async function readJson(r:Response){const t=await r.text();if(!r.ok)throw new Error(t||"Request failed.");return t?JSON.parse(t):null}

export default function Batches(){
 const [batches,setBatches]=useState<Batch[]>([]); const [error,setError]=useState("");
 const [form,setForm]=useState({name:"",productionType:"BROILER",layerStage:"CHICK",species:"CHICKEN",breed:"",strain:"",sex:"MIXED",hatchery:"",sourceLot:"",placementQuality:"GOOD",placementNotes:"",hatchDate:"",purchaseDate:"",initialChicks:"",chickCost:"290",dealer:"",newDealer:"",targetAge:"42",mode:"AGE_OR_WEIGHT",targetWeight:""});
 // Chick prices (owner, 2026-11-02): the usual price, or the price last paid to the chosen dealer; always editable.
 type ChickPrices={defaultPriceMinor:number;dealers:{id:string;name:string;lastPriceMinor:number|null;lastBought:string|null}[]};
 const [prices,setPrices]=useState<ChickPrices>({defaultPriceMinor:290,dealers:[]});
 const [priceTouched,setPriceTouched]=useState(false);
 const loadPrices=async()=>{try{const r=await fetch("/api/chick-prices",{cache:"no-store"});if(!r.ok)return;const d=await r.json() as ChickPrices;setPrices(d);setForm(f=>f.dealer===""&&!priceTouched?{...f,chickCost:String(d.defaultPriceMinor)}:f)}catch{/* the form keeps its own default */}};
 const chooseDealer=(dealer:string)=>{const known=prices.dealers.find(d=>d.id===dealer);setPriceTouched(false);setForm(f=>({...f,dealer,newDealer:dealer==="__new"?f.newDealer:"",chickCost:String(known?.lastPriceMinor??prices.defaultPriceMinor)}))};
 const saveUsualPrice=async()=>{try{const r=await fetch("/api/chick-prices",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({defaultPriceMinor:Number(form.chickCost)})});const d=await readJson(r);setPrices(p=>({...p,defaultPriceMinor:d.defaultPriceMinor}));setError("")}catch(e){setError(e instanceof Error?e.message:"Unable to save the usual price.")}};
 const [showCompleted,setShowCompleted]=useState(false);
 const visibleBatches=batches.filter(b=>showCompleted || !["CLOSED","SLAUGHTERED"].includes(b.status));
 async function closeBatch(batch: Batch) {
   if (!window.confirm(`Close "${batch.name}" and keep all its farm history?`)) return;
   try {
     const r=await fetch("/api/batches?id="+encodeURIComponent(batch.id),{method:"PATCH"});
     if (!r.ok) throw new Error((await r.json()).error || "Unable to close flock.");
     await load();
   } catch(e){setError(e instanceof Error ? e.message : "Unable to close flock.");}
 }
 const [canDelete,setCanDelete] = useState(false);
 useEffect(() => {
   fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => setCanDelete(d?.user?.role === "OWNER")).catch(() => {});
 }, []);
 async function removeBatch(batch: Batch) {
   if (!window.confirm(`Delete "${batch.name}"? Only a flock without operational records can be deleted.`)) return;
   try {
     const response = await fetch("/api/batches?id=" + encodeURIComponent(batch.id), {method:"DELETE"});
     const result = await response.json();
     if (!response.ok) throw new Error(result.error || "Could not delete flock.");
     await load();
   } catch (e) { setError(e instanceof Error ? e.message : "Could not delete flock."); }
 }
 const [mort,setMort]=useState({batchId:"",date:new Date().toISOString().slice(0,10),quantity:"",reason:""});
 const load=async()=>{try{setBatches(await (async()=>{const r=await fetch("/api/batches",{cache:"no-store"});const d=await readJson(r);return Array.isArray(d)?d:[]})());setError("")}catch(e){setError(e instanceof Error?e.message:"Unable to load batches.")}};
 useEffect(()=>{void load();void loadPrices()},[]);
 const create=async(e:React.FormEvent)=>{e.preventDefault();try{const r=await fetch("/api/batches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:form.name,productionType:form.productionType,layerStage:form.layerStage,species:form.species,breed:form.breed||null,strain:form.strain||null,sex:form.sex||null,hatchery:form.hatchery||null,sourceLot:form.sourceLot||null,placementQuality:form.placementQuality||null,placementNotes:form.placementNotes||null,startDate:form.hatchDate||form.purchaseDate||new Date().toISOString().slice(0,10),hatchDate:form.hatchDate||null,purchaseDate:form.purchaseDate||null,initialChicks:Number(form.initialChicks),chickCostMinor:Number(form.chickCost),...(form.dealer==="__new"&&form.newDealer.trim()?{newDealerName:form.newDealer.trim()}:form.dealer&&form.dealer!=="__new"?{supplierId:form.dealer}:{}),targetSlaughterAgeDays:Number(form.targetAge),slaughterDecisionMode:form.mode,targetLiveWeightKg:form.targetWeight?Number(form.targetWeight):null})});await readJson(r);setForm({...form,name:"",initialChicks:""});void loadPrices();await load()}catch(e){setError(e instanceof Error?e.message:"Unable to create batch.")}};
 const mortality=async(e:React.FormEvent)=>{e.preventDefault();try{const r=await fetch("/api/mortality",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...mort,quantity:Number(mort.quantity)})});await readJson(r);setMort({...mort,quantity:""});await load()}catch(e){setError(e instanceof Error?e.message:"Unable to record mortality.")}};
 return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Flocks</h1><p>Set up broiler meat flocks and layer egg flocks in one place.</p></div></div></header><Nav/><main className="main">
 {error&&<div className="card empty">Error: {error}</div>}
 <section className="section card"><div className="section-head"><div><h2>Start a new flock</h2><p className="muted">Start with the four things you need in the yard. Advanced supplier, placement and production settings can be added without slowing down flock creation.</p></div><span className="badge">FAST SETUP</span></div><form className="form" onSubmit={create}>
  <div className="grid2">
    <label>Flock name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="September Batch A" required/></label>
    <label>Production system<select value={form.productionType} onChange={e=>setForm({...form,productionType:e.target.value})}><option value="BROILER">Broiler - meat production</option><option value="LAYER">Layer - table egg production</option></select></label>
    <label>Initial birds placed<input type="number" min="1" value={form.initialChicks} onChange={e=>setForm({...form,initialChicks:e.target.value})} placeholder="e.g. 120" required/></label>
    <label>Hatch / placement date<input type="date" value={form.hatchDate} onChange={e=>setForm({...form,hatchDate:e.target.value})}/></label>
    <label>Chick dealer<select value={form.dealer} onChange={e=>chooseDealer(e.target.value)}><option value="">Usual dealer (BBD {(prices.defaultPriceMinor/100).toFixed(2)})</option>{prices.dealers.map(d=><option key={d.id} value={d.id}>{d.name}{d.lastPriceMinor!=null?` (last BBD ${(d.lastPriceMinor/100).toFixed(2)})`:""}</option>)}<option value="__new">+ A different dealer…</option></select></label>
    {form.dealer==="__new"&&<label>Dealer name<input value={form.newDealer} maxLength={80} onChange={e=>setForm({...form,newDealer:e.target.value})} placeholder="e.g. the dealer's name" required/></label>}
    <label>Price per chick BBD<input type="number" step="0.01" min="0" value={Number(form.chickCost)/100} onChange={e=>{setPriceTouched(true);setForm({...form,chickCost:String(Math.round(Number(e.target.value)*100))})}}/>
      {form.dealer===""&&Number(form.chickCost)!==prices.defaultPriceMinor&&<button type="button" className="button" style={{marginTop:6}} onClick={()=>void saveUsualPrice()}>Make BBD {(Number(form.chickCost)/100).toFixed(2)} my usual price</button>}</label>
  </div>
  {form.productionType==="LAYER" && <div className="card" style={{marginTop:4}}><div className="section-head"><div><h3>Current layer stage</h3><p>Choose where this flock is today so egg collection and stage history are correct.</p></div><span className="badge">REQUIRED FOR EGGS</span></div><label>Stage<select value={form.layerStage} onChange={e=>setForm({...form,layerStage:e.target.value})}><option value="CHICK">Chick</option><option value="GROWER">Grower</option><option value="PULLET">Pullet</option><option value="PRE_LAY">Pre-lay</option><option value="LAYING">Laying</option><option value="MOLT">Molt</option><option value="SPENT">Spent</option></select></label></div>}
  {form.productionType==="BROILER" && <div className="card" style={{marginTop:4}}><div className="section-head"><div><h3>Broiler harvest target</h3><p>These are planning settings, not an automatic harvest instruction.</p></div><span className="badge">OPTIONAL</span></div><div className="grid2"><label>Target harvest age (days)<input type="number" min="1" value={form.targetAge} onChange={e=>setForm({...form,targetAge:e.target.value})}/></label><label>Harvest decision<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="AGE_OR_WEIGHT">Age or weight</option><option value="AGE_TARGET">Age target</option><option value="WEIGHT_TARGET">Weight target</option><option value="MANUAL">Manual review</option></select></label><label>Target live weight kg<input type="number" min="0" step="0.01" value={form.targetWeight} onChange={e=>setForm({...form,targetWeight:e.target.value})} placeholder="Optional"/></label></div></div>}
  <details className="card" style={{marginTop:4}}>
    <summary style={{cursor:"pointer",fontWeight:800}}>Advanced flock setup</summary>
    <div className="form" style={{marginTop:14}}>
      <div className="grid2">
        <label>Species<select value={form.species} onChange={e=>setForm({...form,species:e.target.value})}><option value="CHICKEN">Chicken</option><option value="DUCK">Duck</option><option value="TURKEY">Turkey</option><option value="OTHER_POULTRY">Other poultry</option></select></label>
        <label>Sex<select value={form.sex} onChange={e=>setForm({...form,sex:e.target.value})}><option>MIXED</option><option>MALE</option><option>FEMALE</option></select></label>
        <label>Breed<input value={form.breed} onChange={e=>setForm({...form,breed:e.target.value})} placeholder="Optional"/></label>
        <label>Strain / line<input value={form.strain} onChange={e=>setForm({...form,strain:e.target.value})} placeholder="Optional"/></label>
        <label>Hatchery / source<input value={form.hatchery} onChange={e=>setForm({...form,hatchery:e.target.value})} placeholder="Optional"/></label>
        <label>Source lot<input value={form.sourceLot} onChange={e=>setForm({...form,sourceLot:e.target.value})} placeholder="Optional supplier lot"/></label>
        <label>Purchase date<input type="date" value={form.purchaseDate} onChange={e=>setForm({...form,purchaseDate:e.target.value})}/></label>
        <label>Placement quality<select value={form.placementQuality} onChange={e=>setForm({...form,placementQuality:e.target.value})}><option>GOOD</option><option>ACCEPTABLE</option><option>POOR</option><option>UNKNOWN</option></select></label>
        <label style={{gridColumn:"1 / -1"}}>Placement notes<input value={form.placementNotes} onChange={e=>setForm({...form,placementNotes:e.target.value})}/></label>
      </div>
    </div>
  </details>
  <button className="primary">Start flock</button>
 </form></section>
 <section className="section card"><h2>Record mortality</h2><form className="form grid2" onSubmit={mortality}><label>Batch<select value={mort.batchId} onChange={e=>setMort({...mort,batchId:e.target.value})} required><option value="">Select batch</option>{batches.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><label>Date<input type="date" value={mort.date} onChange={e=>setMort({...mort,date:e.target.value})}/></label><label>Birds died<input type="number" min="1" value={mort.quantity} onChange={e=>setMort({...mort,quantity:e.target.value})} required/></label><label>Reason<input value={mort.reason} onChange={e=>setMort({...mort,reason:e.target.value})} placeholder="Optional"/></label><button className="primary">Record mortality</button></form></section>
 <section className="section"><h2>Production batches</h2><label><input type="checkbox" checked={showCompleted} onChange={e=>setShowCompleted(e.target.checked)}/> Include completed flocks</label><div className="list">{visibleBatches.length===0?<div className="card empty">No flocks in this view.</div>:visibleBatches.map(b=>{const died=b.mortalityEvents.reduce((s,m)=>s+m.quantity,0);const live=b.liveBirdCount??Math.max(0,b.initialChicks-died);const production=b.productionType||(b.species==="LAYER"?"LAYER":"BROILER");return <article className="card row" key={b.id}><div><strong>{b.name}</strong><span>{production==="LAYER"?"Layer flock":"Broiler flock"}{production==="LAYER"&&b.layerStage?" · "+b.layerStage.replaceAll("_"," ").toLowerCase():""} · {b.hatchDate?new Date(b.hatchDate).toLocaleDateString():"Hatch date unknown"} · {b.status}</span></div><div><strong>{live}</strong><span>live birds</span></div><div><strong>Day {Math.max(0,Math.floor((Date.now()-new Date(b.hatchDate||b.purchaseDate||b.startDate).getTime())/86400000))}</strong><span>flock age</span></div><div><strong>{production==="LAYER"?"Egg production":b.expectedSlaughter?new Date(b.expectedSlaughter).toLocaleDateString():"Not set"}</strong><span>{production==="LAYER"?"No broiler harvest target":"approx. harvest date"}</span></div><div><strong>{production==="LAYER"?"Not applicable":b.targetLiveWeightKg?Number(b.targetLiveWeightKg).toFixed(2)+" kg":"Not set"}</strong><span>{production==="LAYER"?"Layer production":"target live weight"}</span></div>{canDelete && production==="BROILER" && live===0 && b.status==="ACTIVE" && <button type="button" onClick={()=>void closeBatch(b)}>Close flock</button>}{canDelete && <button type="button" onClick={() => void removeBatch(b)}>Delete flock</button>}</article>})}</div></section>
 </main></div>
}