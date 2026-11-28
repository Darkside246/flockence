"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";

type Row={batch:any,lifecycle:any};

export default function Planning(){
  const [rows,setRows]=useState<Row[]>([]);
  const [error,setError]=useState("");
  const load=async()=>{try{const r=await fetch("/api/lifecycle",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Unable to load lifecycle.");setRows(Array.isArray(d)?d:[]);setError("")}catch(e){setError(e instanceof Error?e.message:"Unable to load lifecycle.")}};
  useEffect(()=>{void load()},[]);
  return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Production planning</h1><p>Daily flock age, weight targets and harvest readiness flow from the batch records already in Flockence.</p></div><span className="badge">LIVE PLANNING</span></div></header><Nav/><main className="main">
    <section className="ops-note planning-intro"><h2>Flock lifecycle</h2><p>Enter a hatch date when known. Purchase date can be used as a temporary lifecycle anchor, but the app labels it as an estimate. Six weeks is a planning target, not an automatic slaughter command.</p></section>
    {error&&<section className="section card"><strong>{error}</strong></section>}
    {rows.length===0?<section className="section ds-empty">No batches recorded yet. Create a batch first.</section>:<section className="section card"><div className="ds-table-wrap"><table className="ds-table planning-table"><thead><tr><th scope="col">Flock</th><th scope="col">Approx. age target</th><th scope="col">Weight readiness</th><th scope="col">Weight target date</th><th scope="col">Harvest signal</th></tr></thead><tbody>{rows.map(x=><tr key={x.batch.id}>
      <th scope="row"><strong>{x.batch.name}</strong><span>{x.lifecycle.source.replaceAll("_"," ")} · Day {x.lifecycle.ageDays} · Week {x.lifecycle.ageWeeks}</span><span className="ds-chip plain">{x.batch.slaughterDecisionMode.replaceAll("_"," ")}</span></th>
      <td><strong>{new Date(x.lifecycle.ageTargetDate).toLocaleDateString()}</strong><span>{x.lifecycle.daysToAgeTarget===0?"Target reached":x.lifecycle.daysToAgeTarget+" days remaining"}</span></td>
      <td><strong>{x.lifecycle.weightReady?"Target reached":"Not reached"}</strong><span>{x.lifecycle.adgKgPerDay?(x.lifecycle.adgKgPerDay*1000).toFixed(0)+" g/day observed gain":"Add two live-weight records to project weight date"}</span></td>
      <td><strong>{x.lifecycle.projectedWeightDate?new Date(x.lifecycle.projectedWeightDate).toLocaleDateString():"Not enough data"}</strong><span>{x.batch.targetLiveWeightKg?"Target "+Number(x.batch.targetLiveWeightKg).toFixed(2)+" kg live":"No live-weight target configured"}</span></td>
      <td><strong>{x.lifecycle.recommendation.replaceAll("_"," ")}</strong><span>{x.lifecycle.isBeyondSixWeeks?"Beyond 6 weeks - review weight, feed cost and market demand":"Within normal 6-week planning window"}</span></td>
    </tr>)}</tbody></table></div></section>}
    <section className="section card"><h2>Calculation rules</h2><div className="rule-list">
      <div><strong>1. Daily age</strong><span>Age is calculated from hatch date. If hatch date is unavailable, purchase date is used and clearly marked as an estimate.</span></div>
      <div><strong>2. Age target</strong><span>The default is 42 days, configurable per batch. The date is approximate and never replaces an actual slaughter record.</span></div>
      <div><strong>3. Weight target</strong><span>If a farmer wants heavier birds, enter a live-weight target and record weights. The app uses observed average daily gain to estimate when that target may be reached.</span></div>
      <div><strong>4. Decision</strong><span>AGE, WEIGHT, AGE OR WEIGHT, and MANUAL modes let the farmer decide how to harvest. Carrying birds beyond six weeks remains fully supported.</span></div>
    </div></section>
  </main></div>
}