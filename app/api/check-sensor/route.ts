import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { configuredSensors } from "@/lib/govee.mjs";

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const farmId = session.user!.farmId;
  const batchId = new URL(request.url).searchParams.get("batchId");
  const none = () => NextResponse.json(null,{headers:{"Cache-Control":"no-store"}});
  if (!batchId || farmId !== (process.env.FARM_ID || "default-farm") || !process.env.GOVEE_SENSORS) return none();
  const batch = await prisma.batch.findFirst({where:{id:batchId,farmId,status:"ACTIVE"},select:{id:true}});
  if (!batch) return none();
  const assigned = configuredSensors(process.env.GOVEE_SENSORS).filter((s: {batchIds?:string[]}) => s.batchIds?.includes(batch.id));
  if (assigned.length !== 1) return none();
  const now = new Date();
  const row = await prisma.thermometerReading.findFirst({where:{farmId,sensor:assigned[0].name,source:"GOVEE_POLL",
    readAt:{gte:new Date(now.getTime()-15*60000),lte:now}},orderBy:{readAt:"desc"},
    select:{sensor:true,readAt:true,temperatureC:true,humidityPercent:true}});
  return NextResponse.json(row,{headers:{"Cache-Control":"no-store"}});
}
