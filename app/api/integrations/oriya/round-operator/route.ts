import {createHash} from "node:crypto";
import {DEFAULT_FARM_ID,enterFarm,currentFarmId} from "@/lib/farm-scope";
import {farmLinkConfig} from "@/lib/oriya-farm-link";
import {verifyOriyaSignature} from "@/lib/oriya-link.mjs";
import {defaultPolicy,policyKey,farmClock,type Policy} from "@/lib/rounds-policy";
import {prisma} from "@/lib/prisma";
import {withFarmPens} from "@/lib/farm-pens";
import {recordMortality} from "@/lib/record-mortality";
import {saveOperatorRound} from "@/lib/operator-round";
export async function POST(req:Request){
  const farmId=req.headers.get("x-flockence-farm") ?? DEFAULT_FARM_ID;
  if(!/^[\w-]{3,64}$/.test(farmId))return Response.json({}, {status:400});
  enterFarm(farmId);
  const link=await farmLinkConfig();if(!link)return Response.json({error:"Farm link unavailable"},{status:403});
  const raw=Buffer.from(await req.arrayBuffer());
  if(raw.length>8192 || !verifyOriyaSignature(link.secret,req.headers.get("x-oriya-timestamp"),req.headers.get("x-oriya-signature"),raw).ok)return Response.json({}, {status:401});
  const b=JSON.parse(raw.toString());
  if(b.type!=="ROUND_OPERATOR_V1")return Response.json({}, {status:400});
  const policy=await prisma.setting.findFirst({where:{farmId,key:policyKey}});
  const p:Policy=policy?JSON.parse(policy.value):defaultPolicy;
  const {date}=farmClock(new Date(),p.zone);
  if(b.action==="context"){
    const day=new Date(date+"T00:00:00Z");
    const active=await prisma.batch.findMany({where:{farmId,status:"ACTIVE",startDate:{lt:new Date(+day+86400000)}},select:{id:true,name:true,startDate:true,weights:{where:{liveOrDressed:"LIVE",date:{lte:day}},orderBy:{date:"desc"},take:1,select:{avgWeightKg:true,date:true}}},orderBy:{name:"asc"}});
    const done=new Set((await prisma.dailyFlockCheck.findMany({where:{farmId,date:day},select:{batchId:true}})).map(c=>c.batchId));
    const pens=await withFarmPens(farmId,async(_tx,rows)=>rows.map(r=>JSON.parse(r.value)).filter(p=>p.active!==false).map(p=>({name:p.name,feeder:p.feederSystem??"",drinker:p.drinkerSystem??""})));
    return Response.json({pens,date,first:p.first,deadline:p.deadline,interval:p.interval,zone:p.zone,batches:active.map(b=>({id:b.id,name:b.name,ageDays:Math.floor((+day-b.startDate.getTime())/86400000),weightKg:b.weights[0]?Number(b.weights[0].avgWeightKg):null,weightDate:b.weights[0]?.date.toISOString().slice(0,10)??null,checked:done.has(b.id)}))});
  }
  if(!["confirmed-loss","confirmed-round"].includes(b.action)||!/^\d{4}-\d\d-\d\d$/.test(b.date)||b.date>date||typeof b.batchId!=="string"||!/^([a-f0-9]{64})$/.test(b.report)||!["operator","farm hand"].includes(b.actor))return Response.json({}, {status:400});
  const id="wa-"+createHash("sha256").update(currentFarmId()+":"+b.report).digest("hex");
  const note="Confirmed by "+b.actor+" in Oriya Operator Mode.";
  if(b.action==="confirmed-loss"){
    if(!Number.isSafeInteger(b.quantity)||b.quantity<1||b.quantity>100000)return Response.json({}, {status:400});
    return recordMortality({batchId:b.batchId,date:b.date,quantity:b.quantity,notes:[note,typeof b.notes==="string"?b.notes.slice(0,1200):""].filter(Boolean).join(" ")},id);
  }
  if(typeof b.notes!=="string"||!b.notes.trim()||b.notes.length>1500)return Response.json({}, {status:400});
  return saveOperatorRound(farmId,b.batchId,b.date,note+" "+b.notes,id);
}
