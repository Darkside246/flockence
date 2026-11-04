import { currentUserOrResponse,currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { defaultPolicy, validPolicy,policyKey } from "@/lib/rounds-policy";
export async function GET(req:Request) {
  const access=await currentUserOrResponse(req);if(access.response)return access.response;
  const row=await prisma.setting.findFirst({where:{farmId:access.user!.farmId,key:policyKey}});
  return Response.json({...defaultPolicy,...(row?JSON.parse(row.value):{}),emailReady:!!(process.env.RESEND_API_KEY && process.env.RESEND_FROM)},{headers:{"Cache-Control":"no-store"}});
}
export async function PUT(req:Request) {
  const access=await currentUserOrRoleResponse(req,["OWNER"]);if(access.response)return access.response;
  const farmId=access.user!.farmId;
  const input=await req.json().catch(()=>null);
  if(!validPolicy(input))return Response.json({error:"Choose a valid time zone, reminder window, interval and delivery channel."},{status:400});
  if(input.emailUserId && !await prisma.user.findFirst({where:{farmId,id:input.emailUserId,role:{in:["OWNER","MANAGER","WORKER"]}},select:{id:true}}))return Response.json({error:"Choose an active farm team member."},{status:400});
  const value=JSON.stringify(Object.fromEntries(Object.keys(defaultPolicy).map(k=>[k,input[k]])));
  await prisma.setting.upsert({where:{farmId_key:{farmId,key:policyKey}},create:{farmId,key:policyKey,value},update:{value}});
  return Response.json({saved:true});
}
