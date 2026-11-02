import test from "node:test";
import assert from "node:assert/strict";
import {
  autoDecision, climateForOriya, farmHour, farmOffset, isoWithOffset, liveViewInterval, parseLocalTime, parseOffset, parseThermometerCsv, referenceMinutes,
} from "../lib/climate.mjs";

const OFFSET = "-04:00";

test("farm clock: offsets, times written with the farm's offset, and the farm's hour", () => {
  assert.equal(parseOffset("-04:00"), -240);
  assert.equal(parseOffset("+05:30"), 330);
  assert.equal(parseOffset("4"), null);
  assert.equal(farmOffset({}), "-04:00");
  assert.equal(farmOffset({ FARM_UTC_OFFSET: "nonsense" }), "-04:00");
  const at = new Date("2026-10-01T10:15:00Z");
  assert.equal(isoWithOffset(at, OFFSET), "2026-10-01T06:15:00-04:00");
  assert.equal(farmHour(at, OFFSET), 6);
  assert.equal(farmHour(new Date("2026-10-01T02:30:00Z"), OFFSET), 22);
});

test("export times are read as the farm's clock; impossible dates are refused", () => {
  assert.equal(parseLocalTime("2026-08-11 17:04", OFFSET).toISOString(), "2026-08-11T21:04:00.000Z");
  assert.equal(parseLocalTime("2026/08/11 17:04:30", OFFSET).toISOString(), "2026-08-11T21:04:30.000Z");
  assert.equal(parseLocalTime("08/11/2026 17:04", OFFSET).toISOString(), "2026-08-11T21:04:00.000Z");
  assert.equal(parseLocalTime("25/08/2026 01:00", OFFSET).toISOString(), "2026-08-25T05:00:00.000Z");
  assert.equal(parseLocalTime("2026-02-30 10:00", OFFSET), null);
  assert.equal(parseLocalTime("yesterday", OFFSET), null);
});

test("reads a SwitchBot-style export: time, °C, humidity; skips bad rows; ignores dew point and other columns", () => {
  const csv = [
    '﻿"Timestamp","Temperature_Celsius(°C)","Relative_Humidity(%)","DPT_Celsius(°C)","VPD(kPa)"',
    '"2026-07-11 21:32","26.5","89.2","24.6","0.37"',
    '"2026-07-11 21:33","26.5","89.1","24.6","0.37"',
    '"2026-07-11 21:34","","89.0","",""',
    '"2026-07-11 21:35","99.9","89.0","",""',
  ].join("\r\n");
  const parsed = parseThermometerCsv(csv, OFFSET);
  assert.equal(parsed.error, null);
  assert.equal(parsed.readings.length, 2);
  assert.equal(parsed.skipped, 2);
  assert.deepEqual(parsed.readings[0], { readAt: new Date("2026-07-12T01:32:00Z"), temperatureC: 26.5, humidityPct: 89.2 });
});

test("reads Fahrenheit and semicolon files; refuses files without time and temperature", () => {
  const f = parseThermometerCsv("Date;Temperature_Fahrenheit(℉);Relative_Humidity(%)\n2026-10-01 01:47;89.24;75,2\n", OFFSET);
  assert.equal(f.readings.length, 1);
  assert.equal(f.readings[0].temperatureC, 31.8);
  assert.equal(f.readings[0].humidityPct, 75.2);
  assert.equal(parseThermometerCsv("a,b\n1,2\n", OFFSET).error, "COLUMNS_NOT_FOUND");
  assert.equal(parseThermometerCsv("", OFFSET).error, "EMPTY");
});

test("climate for Oriya: latest reading per thermometer, the one about an hour before, nothing older than 3 hours", () => {
  const now = new Date("2026-10-01T05:47:30Z");
  const r = (iso, t, h = 75) => ({ readAt: new Date(iso), temperatureC: t, humidityPct: h });
  const readings = new Map([
    ["Thermo 1", [r("2026-10-01T05:47:00Z", 31.84, 75.21), r("2026-10-01T04:47:00Z", 30.1), r("2026-10-01T04:20:00Z", 29)]],
    ["Floor 2", [r("2026-10-01T05:46:00Z", 26.5, 89.2)]],
    ["Old import", [r("2026-08-11T21:04:00Z", 28)]],
    ["Bad <name>", [r("2026-10-01T05:47:00Z", 30)]],
  ]);
  const climate = climateForOriya(readings, now, OFFSET);
  assert.deepEqual(climate, [
    { sensor: "Thermo 1", temperatureC: 31.8, readAt: "2026-10-01T01:47:00-04:00", humidityPct: 75.2, hourAgo: { temperatureC: 30.1, minutesBefore: 60 } },
    { sensor: "Floor 2", temperatureC: 26.5, readAt: "2026-10-01T01:46:00-04:00", humidityPct: 89.2 },
  ]);
});

test("schedule: dawn every 15, midday every 30, otherwise hourly; numbers every 10 minutes", () => {
  assert.equal(liveViewInterval(5), 15);
  assert.equal(liveViewInterval(6), 15);
  assert.equal(liveViewInterval(7), 60);
  assert.equal(liveViewInterval(14), 30);
  assert.equal(liveViewInterval(2), 60);
  const base = { hour: 14, minutesSinceNumbers: 3, minutesSinceLiveView: 10, oriyaDueNow: false, liveViewsToday: 5, dailyCap: 40 };
  assert.deepEqual(autoDecision(base), { numbers: false, pictures: "none", capped: false });
  assert.deepEqual(autoDecision({ ...base, minutesSinceNumbers: 10 }), { numbers: true, pictures: "none", capped: false });
  assert.deepEqual(autoDecision({ ...base, minutesSinceLiveView: 30 }), { numbers: true, pictures: "fresh", capped: false });
  assert.deepEqual(autoDecision({ ...base, oriyaDueNow: true }), { numbers: true, pictures: "fresh", capped: false });
  assert.deepEqual(autoDecision({ ...base, minutesSinceLiveView: null, minutesSinceNumbers: null }), { numbers: true, pictures: "fresh", capped: false });
});

test("schedule: the daily Live View limit holds even when Oriya asks", () => {
  const capped = autoDecision({ hour: 6, minutesSinceNumbers: 20, minutesSinceLiveView: 90, oriyaDueNow: true, liveViewsToday: 40, dailyCap: 40 });
  assert.deepEqual(capped, { numbers: true, pictures: "none", capped: true });
});

test("the earlier picture is used only when 5 to 120 minutes old", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  assert.equal(referenceMinutes(new Date("2026-10-01T09:30:00Z"), now), 30);
  assert.equal(referenceMinutes(new Date("2026-10-01T09:58:00Z"), now), null);
  assert.equal(referenceMinutes(new Date("2026-10-01T07:00:00Z"), now), null);
});
