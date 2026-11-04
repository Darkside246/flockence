import {prisma} from "./prisma";
import {lockFlockOperations} from "./poultry-lock";
import {calculateLiveBirdsAtDate} from "./poultry-metrics.mjs";
export async function saveOperatorRound(farmId:string,batchId:string,dateText:string,notes:string,id:string){
  const date=new Date(dateText+"T00:00:00Z");
  if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==dateText)return Response.json({}, {status:400});
  return prisma.$transaction(async tx=>{
    await lockFlockOperations(tx,[batchId]);
    const batch=await tx.batch.findFirst({where:{id:batchId,farmId,status:"ACTIVE",startDate:{lt:new Date(+date+86400000)}}});
    if(!batch)return Response.json({error:"Batch unavailable"},{status:409});
    const prior=await tx.dailyFlockCheck.findFirst({where:{farmId,batchId,date}});
    if(prior)return Response.json({saved:prior.id===id,alreadyChecked:true});
    const snapshot=await tx.birdCount.findFirst({where:{batchId,date:{lte:date}},orderBy:[{date:"desc"},{createdAt:"desc"}]});
    const mortality=await tx.mortalityEvent.findMany({where:{batchId,date:{lte:date}},select:{quantity:true,date:true,createdAt:true}});
    const sent=await tx.slaughterEvent.findMany({where:{batchId,date:{lte:date}},select:{sentQuantity:true,date:true,createdAt:true}});
    const liveCount=calculateLiveBirdsAtDate(batch.initialChicks,snapshot,[...mortality,...sent.map(e=>({...e,quantity:e.sentQuantity}))],date);
    if(liveCount==null)return Response.json({error:"Could not reconcile the flock count."},{status:409});
    await tx.dailyFlockCheck.create({data:{id,farmId,batchId,date,notes,liveCount}});
    return Response.json({saved:true});
  });
}
