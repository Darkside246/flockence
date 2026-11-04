import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { runUnscoped,runAsFarm } from "./farm-scope";
import { farmLinkConfig } from "./oriya-farm-link";
import { postToOriya } from "./oriya";
import { farmClock,policyKey,reminderSlot,validPolicy,type Policy } from "./rounds-policy";

async function checkFarm(farmId:string) {
  const policy=await prisma.setting.findFirst({where:{farmId,key:policyKey}});
  if(!policy)return;
  const p:Policy=JSON.parse(policy.value);
  if(!validPolicy(p))return;
  const {date,time}=farmClock(new Date(),p.zone);
  const slot=reminderSlot(time,p);
  if(slot===null)return;
  const day=new Date(date+"T00:00:00Z");
  const batches=await prisma.batch.findMany({where:{farmId,status:"ACTIVE",startDate:{lt:new Date(+day+86400000)}},select:{id:true,name:true}});
  const checks=await prisma.dailyFlockCheck.findMany({where:{farmId,date:day},select:{batchId:true}});
  const done=new Set(checks.map(c=>c.batchId));
  const missing=batches.filter(b=>!done.has(b.id));
  if(!missing.length)return;
  const names=missing.map(b=>b.name).join(", ").slice(0,900);
  const text="Daily Rounds for "+date+": please check feed, drinking water, equipment and bird losses for "+names+". Record the check in Flockence → Daily Rounds by "+p.deadline+" ("+p.zone+").";
  async function deliver(channel:string,send:(id:string)=>Promise<boolean>) {
    // Keep one row per destination. Providers deduplicate concurrent attempts with the same key.
    const key="ROUNDS::delivery::"+channel;
    const id=createHash("sha256").update([farmId,date,p.first,p.interval,slot,channel].join("|")).digest("hex");
    const row=await prisma.setting.findFirst({where:{farmId,key}});
    if(row && (row.value===id || row.value===date+"|"+id || (row.value.startsWith(date+"|") && Date.now()-row.updatedAt.getTime()<p.interval*60000)))return;
    const delivered=await send(id).catch(()=>false);
    if(!delivered){console.warn("Daily Rounds delivery unavailable",farmId,channel.split("-")[0]);return;}
    await prisma.setting.upsert({where:{farmId_key:{farmId,key}},create:{farmId,key,value:date+"|"+id},update:{value:date+"|"+id}});
  }
  if(p.email && process.env.RESEND_API_KEY && process.env.RESEND_FROM){
    const owners=await prisma.user.findMany({where:{farmId,...(p.emailUserId?{id:p.emailUserId,role:{in:["OWNER","MANAGER","WORKER"] as ("OWNER"|"MANAGER"|"WORKER")[]}}:{role:"OWNER" as const})},select:{id:true,email:true}});
    for(const owner of owners)await deliver("email-"+owner.id,async id=>(await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(10000),
      headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":id},
      body:JSON.stringify({from:process.env.RESEND_FROM,to:[owner.email],subject:"Daily Rounds still due · "+date,text})})).ok);
  }
  if(p.whatsapp){const config=await farmLinkConfig();if(config)await deliver("operator",async id=>{
    const reply=await postToOriya(config,"/api/public/farm/chicken-op/round-reminder",{eventId:id,date,deadline:p.deadline,zone:p.zone,first:p.first,interval:p.interval,batches:missing.map(b=>b.name.slice(0,100)).slice(0,100)});
    return reply.status===201 && (reply.json as {accepted?:boolean}|null)?.accepted===true;
  });}
}
let started=false,busy=false;
export function startRoundReminders(){
  if(started)return;started=true;
  const tick=async()=>{if(busy)return;busy=true;try{
    const farms=await runUnscoped(()=>prisma.setting.findMany({where:{key:policyKey},select:{farmId:true}}));
    for(const {farmId} of farms){try{await runAsFarm(farmId,()=>checkFarm(farmId));}catch{console.error("Daily Rounds reminder failed for farm",farmId);}}
  }catch{console.error("Daily Rounds scheduler unavailable");}finally{busy=false;}};
  setInterval(()=>void tick(),60000).unref();
}
