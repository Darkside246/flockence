"use client";
import { useEffect,useState } from "react";
import { defaultPolicy } from "@/lib/rounds-policy";
import { useSession } from "./auth-gate";
export function RoundsSettings(){
  const owner=useSession()?.role==="OWNER";
  const [emailReady,setEmailReady]=useState(false);
  const [members,setMembers]=useState<{id:string;name:string;role:string}[]>([]);
  useEffect(()=>{if(owner)fetch("/api/team").then(r=>r.ok?r.json():null).then(d=>setMembers(d?.users??[])).catch(()=>{});},[owner]);
  const [p,set]=useState(defaultPolicy),[msg,setMsg]=useState(""),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{fetch("/api/rounds-policy").then(async r=>{if(!r.ok)throw Error();const {emailReady,...saved}=await r.json();setEmailReady(emailReady);set(saved);setReady(true);}).catch(()=>setMsg("Could not load the reminder policy."));},[]);
  return <section className="section card"><h2>Daily Rounds reminders</h2><p>Ask about active batches missing a check for that farm day. Reminders stop when all checks are recorded or the deadline passes.</p>
  <fieldset disabled={!owner||!ready||busy}><label><input type="checkbox" checked={p.enabled} onChange={e=>set({...p,enabled:e.target.checked})}/> Enable reminders</label>
  <div className="grid2"><label>First reminder<input type="time" value={p.first} onChange={e=>set({...p,first:e.target.value})}/></label><label>Evening deadline<input type="time" value={p.deadline} onChange={e=>set({...p,deadline:e.target.value})}/></label>
  <label>Repeat every<select value={p.interval} onChange={e=>set({...p,interval:Number(e.target.value)})}>{[30,45,60].map(m=><option key={m} value={m}>{m} minutes</option>)}</select></label>
  <label>Farm time zone<input value={p.zone} onChange={e=>set({...p,zone:e.target.value})} placeholder="America/Barbados"/></label></div>
  <label><input type="checkbox" checked={p.email} onChange={e=>set({...p,email:e.target.checked})}/> Email reminders</label>
  <label>Email recipient<select value={p.emailUserId??""} onChange={e=>set({...p,emailUserId:e.target.value})}><option value="">All farm owners</option>{members.filter(m=>m.role!=="READ_ONLY").map(m=><option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}</select></label>
  <label><input type="checkbox" checked={p.whatsapp} onChange={e=>set({...p,whatsapp:e.target.checked})}/> WhatsApp the farm’s linked Oriya operator</label>
  <p>In signed-in Oriya farm chats, a photo alone can start a loss report. Oriya checks the image and its sent time, removes embedded metadata before AI analysis, and asks you to confirm the batch and count before saving a loss.</p>
  <button className="button" onClick={async()=>{setBusy(true);try{const r=await fetch("/api/rounds-policy",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});if(!r.ok)throw Error((await r.json()).error);setMsg("Reminder policy saved.");}catch(e){setMsg(e instanceof Error?e.message:"Save failed.");}finally{setBusy(false);}}}>Save reminders</button></fieldset>
  {ready && p.email && !emailReady && <p role="status">Email delivery needs a configured Resend sender on the Flockence server.</p>}
  {!owner && <small>Only the farm owner can change this policy.</small>}<p role="status">{msg}</p></section>;
}
