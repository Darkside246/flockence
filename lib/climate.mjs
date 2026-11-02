// Thermometers and the camera schedule for Oriya (docs/ORIYA_LINK.md, 2026-11-02).
// Pure functions only (no database, no network), so node --test can check them directly.
//
// Flockence collects thermometer readings (imported from the thermometer app's export, or sent live later) and
// sends each thermometer's latest reading with every flock check. Oriya works out the heat index, dew point and the
// rest; Flockence only collects and stamps times with the farm's own clock.

const SENSOR = /^[A-Za-z0-9_. -]{1,40}$/;

/** The farm's UTC offset ("-04:00" for Barbados) as minutes, or null when it is not a real offset. */
export function parseOffset(text) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  if (Number(match[2]) > 14 || Number(match[3]) > 59) return null;
  return match[1] === "-" ? -minutes : minutes;
}

export function farmOffset(env) {
  const text = String(env.FARM_UTC_OFFSET ?? "-04:00").trim();
  return parseOffset(text) === null ? "-04:00" : text;
}

/** An ISO time written with the farm's offset, e.g. "2026-10-01T06:15:00-04:00". */
export function isoWithOffset(date, offset) {
  const minutes = parseOffset(offset) ?? 0;
  const local = new Date(date.getTime() + minutes * 60_000).toISOString().slice(0, 19);
  return `${local}${offset}`;
}

/** The hour on the farm's clock. */
export function farmHour(date, offset) {
  return new Date(date.getTime() + (parseOffset(offset) ?? 0) * 60_000).getUTCHours();
}

// ── Thermometer exports ───────────────────────────────────────────────────────────────────────────────────────────

function splitCsvLine(line, separator) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) { cells.push(cell.trim()); cell = ""; } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** A local date and time from the export ("2026-08-11 17:04", "2026/08/11 17:04:00", "08/11/2026 17:04"), as UTC. */
export function parseLocalTime(text, offset) {
  const value = String(text ?? "").trim();
  let y, mo, d, h, mi, s;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (m) [, y, mo, d, h, mi, s] = m;
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value);
    if (!m) return null;
    // Month first unless the first number cannot be a month.
    const [, a, b] = m;
    [mo, d] = Number(a) > 12 ? [b, a] : [a, b];
    [, , , y, h, mi, s] = m;
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  const check = new Date(utc);
  if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d) || Number(h) > 23) return null;
  // Zone given in the cell itself (rare) wins; otherwise it is the farm's clock.
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const minutes = zone ? (zone[1] === "Z" ? 0 : parseOffset(zone[1])) : parseOffset(offset) ?? 0;
  return new Date(utc - minutes * 60_000);
}

const number = (text) => {
  const n = Number(String(text ?? "").replace(",", ".").replace(/[^0-9.+-]/g, ""));
  return String(text ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Readings from a thermometer app's CSV export (SwitchBot-style: a time column, a temperature column in °C or °F,
 * usually a humidity column). Columns are found by their headings; anything else in the file is ignored. Rows that
 * cannot be read are skipped and counted, never guessed.
 */
export function parseThermometerCsv(text, offset) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { readings: [], skipped: 0, error: "EMPTY" };
  const separator = (lines[0].match(/;/g) ?? []).length > (lines[0].match(/,/g) ?? []).length ? ";" : ",";
  const headings = splitCsvLine(lines[0], separator).map((h) => h.toLowerCase());
  const timeCol = headings.findIndex((h) => /time|date/.test(h));
  const tempCol = headings.findIndex((h) => /temp/.test(h) && !/dew|dpt|feel/.test(h));
  const humidCol = headings.findIndex((h) => /humid|rh/.test(h) && !/abs/.test(h));
  if (timeCol < 0 || tempCol < 0) return { readings: [], skipped: 0, error: "COLUMNS_NOT_FOUND" };
  const fahrenheit = /fahrenheit|°f|℉|\(f\)/.test(headings[tempCol]);
  const readings = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, separator);
    const at = parseLocalTime(cells[timeCol], offset);
    let temperatureC = number(cells[tempCol]);
    if (temperatureC !== null && fahrenheit) temperatureC = (temperatureC - 32) * 5 / 9;
    const humidity = humidCol >= 0 ? number(cells[humidCol]) : null;
    if (!at || temperatureC === null || temperatureC < -20 || temperatureC > 70 || (humidity !== null && (humidity < 0 || humidity > 100))) { skipped += 1; continue; }
    readings.push({ readAt: at, temperatureC: Math.round(temperatureC * 100) / 100, humidityPct: humidity === null ? null : Math.round(humidity * 100) / 100 });
  }
  return { readings, skipped, error: null };
}

export function validSensorName(name) {
  return typeof name === "string" && SENSOR.test(name.trim());
}

// ── What goes to Oriya ────────────────────────────────────────────────────────────────────────────────────────────

/** Readings older than this are not sent: Oriya would only call the thermometer quiet, and imported history is not "now". */
export const SEND_WITHIN_MINUTES = 180;

/**
 * Oriya's `climate` list from each thermometer's recent readings (newest first or in any order): the latest reading,
 * and the reading closest to an hour before it (45 to 90 minutes) for the heating rate.
 */
export function climateForOriya(readingsBySensor, now, offset) {
  const out = [];
  for (const [sensor, readings] of readingsBySensor) {
    if (!validSensorName(sensor) || !readings.length) continue;
    const sorted = [...readings].sort((a, b) => b.readAt.getTime() - a.readAt.getTime());
    const latest = sorted[0];
    if (now.getTime() - latest.readAt.getTime() > SEND_WITHIN_MINUTES * 60_000 || latest.readAt.getTime() > now.getTime() + 5 * 60_000) continue;
    const entry = { sensor: sensor.trim(), temperatureC: Math.round(latest.temperatureC * 10) / 10, readAt: isoWithOffset(latest.readAt, offset) };
    if (latest.humidityPct !== null && latest.humidityPct !== undefined) entry.humidityPct = Math.round(latest.humidityPct * 10) / 10;
    let best = null;
    for (const r of sorted.slice(1)) {
      const minutes = Math.round((latest.readAt.getTime() - r.readAt.getTime()) / 60_000);
      if (minutes < 45 || minutes > 90) continue;
      if (!best || Math.abs(minutes - 60) < Math.abs(best.minutes - 60)) best = { minutes, temperatureC: r.temperatureC };
    }
    if (best) entry.hourAgo = { temperatureC: Math.round(best.temperatureC * 10) / 10, minutesBefore: best.minutes };
    out.push(entry);
    if (out.length >= 10) break;
  }
  return out;
}

// ── Camera schedule ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Minutes between Live View checks by the farm's hour: dawn (live birds stand up, the dead stay down) every 15,
 * the hot middle of the day every 30, otherwise hourly.
 */
export function liveViewInterval(hour) {
  if (hour >= 5 && hour < 7) return 15;
  if (hour >= 11 && hour < 17) return 30;
  return 60;
}

export const NUMBERS_EVERY_MINUTES = 10;
export const DEFAULT_DAILY_LIVE_VIEWS = 40;

/**
 * What an automatic run should do now. Live View wakes the cameras and uses battery, so it is capped per day;
 * Oriya's "look again in N minutes" brings it forward, never past the cap.
 */
export function autoDecision({ hour, minutesSinceNumbers, minutesSinceLiveView, oriyaDueNow, liveViewsToday, dailyCap }) {
  const capped = liveViewsToday >= Math.max(0, dailyCap);
  const scheduled = minutesSinceLiveView === null || minutesSinceLiveView >= liveViewInterval(hour);
  const liveView = !capped && (scheduled || oriyaDueNow);
  const numbers = liveView || minutesSinceNumbers === null || minutesSinceNumbers >= NUMBERS_EVERY_MINUTES;
  return { numbers, pictures: liveView ? "fresh" : "none", capped };
}

/** The earlier picture is used only when it is 5 to 120 minutes old (what Oriya accepts). */
export function referenceMinutes(savedAt, now) {
  const minutes = Math.round((now.getTime() - savedAt.getTime()) / 60_000);
  return minutes >= 5 && minutes <= 120 ? minutes : null;
}
