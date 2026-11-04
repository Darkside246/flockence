import { validSensorName } from "./climate.mjs";

export function goveeReading(payload, sensor, readAt) {
  if (!Array.isArray(payload?.capabilities) || payload.device !== sensor.device || payload.sku !== sensor.sku)
    throw new Error("Govee returned an unexpected device.");
  const value = instance => payload.capabilities.find(c => c.instance === instance)?.state?.value;
  if (value("online") !== true) return null;
  const raw = value("sensorTemperature");
  if (!Number.isFinite(raw)) return null;
  const temperatureC = sensor.unit === "F" ? (raw - 32) * 5 / 9 : raw;
  const humidity = value("sensorHumidity");
  if (temperatureC < -20 || temperatureC > 70 ||
      (humidity != null && (!Number.isFinite(humidity) || humidity < 0 || humidity > 100)))
    throw new Error("Govee reading is outside the supported range.");
  return { sensor: sensor.name, readAt, temperatureC: Math.round(temperatureC * 100) / 100,
    humidityPercent: humidity ?? null, source: "GOVEE_POLL" };
}

export function configuredSensors(json) {
  const sensors = JSON.parse(json);
  if (!Array.isArray(sensors) || !sensors.length || sensors.some(s => !s || !validSensorName(s.name) ||
      (s.batchIds !== undefined && (!Array.isArray(s.batchIds) || s.batchIds.some(id => typeof id !== "string" || !id))) || s.name !== s.name.trim() || !s.device || !s.sku || !["C", "F"].includes(s.unit)) ||
      new Set(sensors.map(s => s.name)).size !== sensors.length ||
      new Set(sensors.map(s => s.device)).size !== sensors.length) throw new Error("Invalid GOVEE_SENSORS configuration.");
  return sensors;
}
