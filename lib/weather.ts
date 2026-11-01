import { prisma } from "@/lib/prisma";
import { FARM_ID } from "@/lib/operations";

export type HeatRisk = "LOW" | "WATCH" | "HIGH";
export interface WeatherHour {
  time: string;
  tempC: number;
  humidityPercent: number;
  rainChancePercent: number;
  precipitationMm: number;
  windKph: number;
  heatRisk: HeatRisk;
}
export interface FarmWeather {
  provider: "WeatherAPI.com";
  fetchedAt: string;
  location: { name: string; latitude: number; longitude: number };
  current: { tempC: number; feelsLikeC: number; humidityPercent: number; windKph: number; precipitationMm: number; condition: string; heatRisk: HeatRisk };
  forecast: WeatherHour[];
  heatAdvice: string;
}
type CacheEntry = { expiresAt: number; weather: FarmWeather };
const cache = new Map<string, CacheEntry>();

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) ? value : fallback;
}
function heatRisk(tempC: number, humidityPercent: number): HeatRisk {
  if (tempC >= 32 || (tempC >= 30 && humidityPercent >= 70)) return "HIGH";
  if (tempC >= 29 || (tempC >= 27 && humidityPercent >= 70)) return "WATCH";
  return "LOW";
}
function adviceFor(risk: HeatRisk) {
  if (risk === "HIGH") return "Heat watch: check house temperature and humidity now, verify drinker flow and water access, and confirm fans and ventilation are working.";
  if (risk === "WATCH") return "Warm conditions expected: check house temperature and humidity, water access, litter condition, and ventilation during the hottest part of the day.";
  return "No weather heat watch from the current outside conditions. Continue normal house checks.";
}
function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
async function settingValue(key: string) {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: FARM_ID, key } } });
  return row?.value?.trim() ?? "";
}
export async function getFarmWeather(): Promise<{ configured: false; reason: string } | { configured: true; weather: FarmWeather }> {
  const key = process.env.WEATHER_API_KEY?.trim();
  const latRaw = await settingValue("weather_latitude");
  const lonRaw = await settingValue("weather_longitude");
  const locationName = (await settingValue("weather_location_name")) || "Farm location";
  if (!key) return { configured: false, reason: "WEATHER_API_KEY is not configured." };
  const latitude = Number(latRaw), longitude = Number(lonRaw);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { configured: false, reason: "Farm weather coordinates are not configured." };
  }
  const cacheMinutes = Math.max(5, numberEnv("WEATHER_CACHE_MINUTES", 30));
  const cacheKey = String(latitude.toFixed(4)) + "," + String(longitude.toFixed(4));
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { configured: true, weather: cached.weather };

  const latest = await prisma.weatherSnapshot.findFirst({
    where: { farmId: FARM_ID, latitude: latitude, longitude: longitude },
    orderBy: { fetchedAt: "desc" },
  });
  if (latest && latest.fetchedAt.getTime() + cacheMinutes * 60_000 > Date.now()) {
    const weather: FarmWeather = {
      provider: "WeatherAPI.com",
      fetchedAt: latest.fetchedAt.toISOString(),
      location: { name: locationName, latitude: Number(latest.latitude), longitude: Number(latest.longitude) },
      current: {
        tempC: Number(latest.tempC),
        feelsLikeC: Number(latest.feelsLikeC),
        humidityPercent: Number(latest.humidityPercent),
        windKph: Number(latest.windKph),
        precipitationMm: Number(latest.precipitationMm),
        condition: latest.condition,
        heatRisk: latest.heatRisk as HeatRisk,
      },
      forecast: JSON.parse(latest.forecastJson) as WeatherHour[],
      heatAdvice: latest.heatAdvice,
    };
    cache.set(cacheKey, { expiresAt: Date.now() + cacheMinutes * 60_000, weather });
    return { configured: true, weather };
  }

  const url = new URL("https://api.weatherapi.com/v1/forecast.json");
  url.searchParams.set("key", key);
  url.searchParams.set("q", latitude + "," + longitude);
  url.searchParams.set("days", "3");
  url.searchParams.set("aqi", "no");
  url.searchParams.set("alerts", "no");
  url.searchParams.set("lang", "en");
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Weather provider returned HTTP " + response.status + ".");
  const payload = await response.json() as any;
  if (!payload?.current) throw new Error("Weather provider returned no current conditions.");

  const forecast: WeatherHour[] = ((payload?.forecast?.forecastday ?? []) as any[])
    .flatMap((day) => Array.isArray(day?.hour) ? day.hour : [])
    .slice(0, 72)
    .map((hour) => {
      const tempC = asNumber(hour?.temp_c), humidityPercent = asNumber(hour?.humidity);
      return { time: String(hour?.time ?? ""), tempC, humidityPercent, rainChancePercent: asNumber(hour?.chance_of_rain), precipitationMm: asNumber(hour?.precip_mm), windKph: asNumber(hour?.wind_kph), heatRisk: heatRisk(tempC, humidityPercent) };
    });

  const currentTemp = asNumber(payload.current.temp_c), currentHumidity = asNumber(payload.current.humidity);
  const risk = heatRisk(currentTemp, currentHumidity);
  const weather: FarmWeather = {
    provider: "WeatherAPI.com",
    fetchedAt: new Date().toISOString(),
    location: { name: String(payload?.location?.name ?? locationName), latitude: asNumber(payload?.location?.lat, latitude), longitude: asNumber(payload?.location?.lon, longitude) },
    current: { tempC: currentTemp, feelsLikeC: asNumber(payload.current.feelslike_c, currentTemp), humidityPercent: currentHumidity, windKph: asNumber(payload.current.wind_kph), precipitationMm: asNumber(payload.current.precip_mm), condition: String(payload?.current?.condition?.text ?? "Unknown"), heatRisk: risk },
    forecast,
    heatAdvice: adviceFor(risk),
  };
  await prisma.weatherSnapshot.create({
    data: {
      farmId: FARM_ID,
      provider: "WeatherAPI.com",
      observedAt: new Date(payload?.current?.last_updated_epoch ? Number(payload.current.last_updated_epoch) * 1000 : Date.now()),
      fetchedAt: new Date(weather.fetchedAt),
      latitude: weather.location.latitude,
      longitude: weather.location.longitude,
      tempC: weather.current.tempC,
      feelsLikeC: weather.current.feelsLikeC,
      humidityPercent: weather.current.humidityPercent,
      windKph: weather.current.windKph,
      precipitationMm: weather.current.precipitationMm,
      condition: weather.current.condition,
      heatRisk: weather.current.heatRisk,
      heatAdvice: weather.heatAdvice,
      forecastJson: JSON.stringify(weather.forecast),
    },
  });
  cache.set(cacheKey, { expiresAt: Date.now() + cacheMinutes * 60_000, weather });
  return { configured: true, weather };
}
