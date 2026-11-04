import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { configuredSensors, goveeReading } from "../lib/govee.mjs";

const prisma = new PrismaClient();
async function api(path, body) {
  const r = await fetch("https://openapi.api.govee.com/router/api/v1/" + path, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { "Govee-API-Key": process.env.GOVEE_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify({ requestId: randomUUID(), payload: body }) : undefined
  });
  if (!r.ok) throw new Error("Govee HTTP " + r.status);
  const data = await r.json();
  if (data.code !== 200) throw new Error("Govee rejected the request.");
  return data;
}
try {
  if (!process.env.GOVEE_API_KEY) throw new Error("Set GOVEE_API_KEY on the server.");
  if (process.argv.includes("--list")) {
    const { data } = await api("user/devices");
    for (const device of data.filter(d => d.capabilities?.some(c => c.instance === "sensorTemperature")))
      console.log(JSON.stringify({ name: device.deviceName, sku: device.sku, device: device.device,
        unit: device.capabilities.find(c => c.instance === "sensorTemperature")?.parameters?.unit ?? "confirm with app" }));
  } else {
    const sensors = configuredSensors(process.env.GOVEE_SENSORS || "[]");
    const farmId = process.env.FARM_ID || "default-farm";
    const readAt = new Date(Math.floor(Date.now() / 60000) * 60000);
    for (const sensor of sensors) {
      try {
        const { payload } = await api("device/state", { sku: sensor.sku, device: sensor.device });
        const row = goveeReading(payload, sensor, readAt);
        if (row) await prisma.thermometerReading.createMany({ data: [{ farmId, ...row }], skipDuplicates: true });
        console.log(sensor.name, row ? "online reading polled" : "no current reading");
      } catch (error) {
        console.error(sensor.name, "poll failed", error.message.startsWith("Govee HTTP") ? error.message : "");
        process.exitCode = 1;
        if (error.message === "Govee HTTP 429") break;
      }
    }
  }
} catch (error) {
  console.error("Govee setup or request failed.", error.message.startsWith("Govee HTTP") ? error.message : "Check server settings.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
