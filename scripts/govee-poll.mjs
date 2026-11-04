import { accountKey, goveeApi, openKey, readSensor } from "../lib/govee-account.mjs";
import { PrismaClient } from "@prisma/client";
import { configuredSensors } from "../lib/govee.mjs";

const prisma = new PrismaClient();
try {

  if (process.argv.includes("--list")) {
    const { data } = await goveeApi(process.env.GOVEE_API_KEY,"user/devices");
    for (const device of data.filter(d => d.capabilities?.some(c => c.instance === "sensorTemperature")))
      console.log(JSON.stringify({ name: device.deviceName, sku: device.sku, device: device.device,
        unit: device.capabilities.find(c => c.instance === "sensorTemperature")?.parameters?.unit ?? "confirm with app" }));
  } else {
    const accounts = await prisma.setting.findMany({where:{key:accountKey}});
    const legacyFarm = process.env.FARM_ID || "default-farm";
    if (!accounts.some(a=>a.farmId===legacyFarm) && process.env.GOVEE_API_KEY && process.env.GOVEE_SENSORS)
      await poll(legacyFarm,process.env.GOVEE_API_KEY,configuredSensors(process.env.GOVEE_SENSORS));
    for (const account of accounts) {
      try {
        const {credential,sensors}=JSON.parse(account.value);
        await poll(account.farmId,openKey(credential,account.farmId),sensors);
      } catch { console.error("Could not load farm sensor settings.",account.farmId); process.exitCode=1; }
    }
  }
} catch (error) {
  console.error("Govee setup or request failed.", error.message.startsWith("Govee HTTP") ? error.message : "Check server settings.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

async function poll(farmId,key,sensors) {
  for (const sensor of sensors) {
    try {
      const row=await readSensor(key,sensor,farmId,prisma);
      console.log(sensor.name,row ? "online reading polled" : "no current reading");
    } catch(error) {
      console.error(sensor.name,"poll failed");
      process.exitCode=1;
      if(error.message==="Govee HTTP 429")break;
    }
  }
}
