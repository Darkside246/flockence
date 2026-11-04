import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { goveeReading } from "./govee.mjs";

export const accountKey = "DEVICE_PRIVATE::GOVEE";
function encryptionKey(farmId) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Missing server encryption secret");
  return hkdfSync("sha256", secret, farmId, "flockence/govee/v1", 32);
}
export function sealKey(value, farmId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(farmId), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64")).join(".");
}
export function openKey(value, farmId) {
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(farmId), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8");
}
export async function goveeApi(key, path, payload) {
  const response = await fetch("https://openapi.api.govee.com/router/api/v1/" + path, {
    method: payload ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: { "Govee-API-Key": key, "Content-Type": "application/json" },
    body: payload ? JSON.stringify({requestId:randomUUID(), payload}) : undefined
  });
  if (!response.ok) throw new Error("Govee HTTP " + response.status);
  const result = await response.json();
  if (result.code !== 200) throw new Error("Govee rejected the request");
  return result;
}
export async function discover(key) {
  const {data} = await goveeApi(key, "user/devices");
  return data.filter(d => d.capabilities?.some(c => c.instance === "sensorTemperature"))
    .map(d => ({device:d.device, sku:d.sku, label:d.deviceName || d.sku}));
}
export async function readSensor(key, sensor, farmId, prisma) {
  const {payload} = await goveeApi(key, "device/state", {device:sensor.device, sku:sensor.sku});
  const row = goveeReading(payload, sensor, new Date(Math.floor(Date.now()/60000)*60000));
  if (row) await prisma.thermometerReading.createMany({data:[{...row,farmId}], skipDuplicates:true});
  return row;
}
