import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { accountKey, goveeApi, discover, openKey, readSensor, sealKey } from "@/lib/govee-account.mjs";
import { configuredSensors } from "@/lib/govee.mjs";

type Sensor = { device:string; sku:string; name:string; unit:"C"|"F" };
type Equipment = {device:string;sku:string;label:string};
type Account = { monitoring?:boolean; equipment?:Equipment[]; credential:string; sensors:Sensor[] };
const reply = (data:unknown, status=200) => NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function handle(request:Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const farmId = session.user!.farmId;
  const where = {farmId_key:{farmId,key:accountKey}};
  try {
    const record = await prisma.setting.findUnique({where});
    const account:Account|null = record ? JSON.parse(record.value) : null;
    if (request.method === "GET") return reply({connected:!!account,monitoring:!!account && account.monitoring !== false,equipment:account?.equipment ?? [],sensors:account?.sensors ?? []});
    const body = await request.json();
    if (body.action === "disconnect") {
      await prisma.setting.deleteMany({where:{farmId,key:accountKey}});
      return reply({connected:false,sensors:[]});
    }
    if (body.action === "connect" && (typeof body.key !== "string" || !body.key.trim() || body.key.length > 512)) return reply({error:"Enter a valid Govee API key."},400);
    if (body.action !== "connect" && !account) return reply({error:"Connect Govee first."},400);
    const key = body.action === "connect" ? body.key.trim() : openKey(account!.credential,farmId);
    if (body.action === "monitoring") {
      if (!record || !account || !account.sensors.length || typeof body.enabled !== "boolean") return reply({error:"Save a temperature sensor first."},400);
      const value = JSON.stringify({...account, monitoring:body.enabled});
      const updated = await prisma.setting.updateMany({where:{farmId,key:accountKey,value:record.value},data:{value}});
      if (!updated.count) return reply({error:"Settings changed. Reload and try again."},409);
      return reply({monitoring:body.enabled});
    }
    if (body.action === "read") {
      const sensor = account!.sensors.find(s=>s.device===body.device);
      if (!sensor) return reply({error:"Select a saved sensor."},400);
      return reply({reading:await readSensor(key,sensor,farmId,prisma)});
    }
    if(body.action==="state"){
      const device=account!.equipment?.find(d=>d.device===body.device);
      if(!device)return reply({error:"Save this device first."},400);
      const {payload}=await goveeApi(key,"device/state",{sku:device.sku,device:device.device});
      if(payload?.device!==device.device || payload.sku!==device.sku)return reply({error:"Unexpected device response."},502);
      return reply({state:(payload.capabilities ?? []).filter(c=>c.state?.value!=null).map(c=>({name:c.instance,value:c.state!.value}))});
    }
    const devices = await discover(key);
    let equipment=account?.equipment ?? [];
    if (body.action === "discover") return reply({devices});
    let sensors = account?.sensors ?? [];
    if (body.action === "connect") {
      sensors=sensors.filter(s=>devices.some(d=>d.device===s.device && d.sku===s.sku && d.temperature));
      equipment=equipment.filter(e=>devices.some(d=>d.device===e.device && d.sku===e.sku));
    } else if(body.action==="equipment"){
      const d=devices.find(d=>d.device===body.device);
      if(!d)return reply({error:"Choose a discovered device."},400);
      equipment=[...equipment.filter(e=>e.device!==d.device),{device:d.device,sku:d.sku,label:d.label}];
    }
    else if (body.action === "select") {
      const device = devices.find(d=>d.device===body.device);
      if (!device?.temperature || typeof body.name !== "string") return reply({error:"Select a discovered sensor and enter a name."},400);
      if (!sensors.some(s=>s.device===device.device) && sensors.length>=6) return reply({error:"Up to six sensors can be saved."},400);
      sensors = [...sensors.filter(s=>s.device!==device.device),{device:device.device,sku:device.sku,name:body.name.trim(),unit:body.unit}];
      try { configuredSensors(JSON.stringify(sensors)); } catch { return reply({error:"Use a unique sensor name of 1–40 letters, numbers, spaces, periods, underscores or dashes and select its unit."},400); }
    } else return reply({error:"Unknown action."},400);
    const value = JSON.stringify({monitoring:account?.monitoring ?? true,credential:sealKey(key,farmId),sensors,equipment});
    // Refuse stale settings when another owner changes or disconnects this account.
    if (record) {
      const updated = await prisma.setting.updateMany({where:{farmId,key:accountKey,value:record.value},data:{value}});
      if (!updated.count) return reply({error:"Settings changed. Reload and try again."},409);
    } else await prisma.setting.create({data:{farmId,key:accountKey,value}});
    return reply({connected:true,monitoring:account?.monitoring ?? true,sensors,devices,equipment});
  } catch (error) {
    if(error instanceof Error && error.message==="Govee HTTP 401")return reply({error:"Govee rejected this key. Paste the latest developer API key issued in Govee Home → Settings → Apply for API Key. Generating a new key disables earlier keys on the account."},400);
    if(error instanceof Error && error.message==="Govee reading is outside the supported range.")return reply({error:"The reading is outside the expected range. Check the sensor source unit in configuration. Fahrenheit data saved as Celsius must be corrected before collecting readings."},400);
    const detail = error instanceof Error && /^Govee HTTP \d{3}$/.test(error.message) ? error.message : "Device settings request failed";
    return reply({error:detail+". Check your connection and API key, then retry."},400);
  }
}
export const GET = handle;
export const POST = handle;
