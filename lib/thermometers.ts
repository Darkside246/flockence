import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { POLL_EVERY_MINUTES, SWITCHBOT_API, readingFromStatus, switchbotConfig, switchbotHeaders } from "@/lib/switchbot.mjs";

/**
 * Live thermometer readings (2026-11-02). Two ways in, both stored in ThermometerReading:
 *   - SwitchBot thermometers through SwitchBot's cloud, read every 5 minutes before a flock check (token and secret
 *     in .env only, never logged, only api.switch-bot.com is called);
 *   - any other thermometer bridge posting to /api/integrations/thermometers/readings with THERMOMETER_PUSH_TOKEN.
 */

const LAST_POLL = "SWITCHBOT_LAST_POLL_AT";

export async function storeReadings(readings: Array<{ sensor: string; readAt: Date; temperatureC: number; humidityPct: number | null }>, source: string): Promise<number> {
  if (!readings.length) return 0;
  await ensureFarm();
  const result = await prisma.thermometerReading.createMany({
    data: readings.map((r) => ({ farmId: currentFarmId(), sensor: r.sensor, readAt: r.readAt, temperatureC: r.temperatureC, humidityPercent: r.humidityPct, source })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Reads each configured SwitchBot thermometer once, at most every 5 minutes. Failures are counted, never thrown. */
export async function pollSwitchbot(now = new Date()): Promise<{ polled: boolean; stored: number; failed: number }> {
  const config = switchbotConfig(process.env);
  if (!config || config.thermometers.size === 0) return { polled: false, stored: 0, failed: 0 };
  await ensureFarm();
  const last = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key: LAST_POLL } }, select: { value: true } });
  const lastAt = last ? Date.parse(last.value) : Number.NaN;
  if (Number.isFinite(lastAt) && now.getTime() - lastAt < POLL_EVERY_MINUTES * 60_000) return { polled: false, stored: 0, failed: 0 };
  await prisma.setting.upsert({ where: { farmId_key: { farmId: currentFarmId(), key: LAST_POLL } }, create: { farmId: currentFarmId(), key: LAST_POLL, value: now.toISOString() }, update: { value: now.toISOString() } });

  const readings: Array<{ sensor: string; readAt: Date; temperatureC: number; humidityPct: number | null }> = [];
  let failed = 0;
  for (const [sensor, deviceId] of config.thermometers) {
    try {
      const response = await fetch(`${SWITCHBOT_API}/v1.1/devices/${encodeURIComponent(deviceId)}/status`, {
        headers: switchbotHeaders(config.token, config.secret), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      });
      const reading = response.ok ? readingFromStatus(JSON.parse((await response.text()).slice(0, 20_000))) : null;
      if (reading) readings.push({ sensor, readAt: now, ...reading }); else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { polled: true, stored: await storeReadings(readings, "SWITCHBOT"), failed };
}
