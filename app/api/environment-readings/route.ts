import {NextResponse} from "next/server";
import {requireCurrentUser,authError} from "@/lib/current-user";
import {prisma} from "@/lib/prisma";
import {accountKey} from "@/lib/govee-account.mjs";
export async function GET(request:Request) {
  try {
    const user=await requireCurrentUser(request);
    const account=await prisma.setting.findUnique({where:{farmId_key:{farmId:user.farmId,key:accountKey}}});
    const sensors: {name:string}[]=account?JSON.parse(account.value).sensors??[]:[];
    const rows=await Promise.all(sensors.slice(0,6).map(async sensor=>{
      const reading=await prisma.thermometerReading.findFirst({where:{farmId:user.farmId,sensor:sensor.name,readAt:{lte:new Date()}},orderBy:{readAt:"desc"}});
      return {name:sensor.name,temperatureC:reading?Number(reading.temperatureC):null,humidityPercent:reading?.humidityPercent==null?null:Number(reading.humidityPercent),readAt:reading?.readAt??null};
    }));
    return NextResponse.json(rows,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return authError(error)??NextResponse.json({error:"Sensor readings unavailable."},{status:503});}
}
