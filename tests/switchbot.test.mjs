import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readIntakeBody, readingFromStatus, switchbotConfig, switchbotHeaders, thermometersFromDeviceList } from "../lib/switchbot.mjs";

const TOKEN = "t".repeat(96);
const SECRET = "s".repeat(32);

test("SwitchBot settings: token, secret and named thermometers only", () => {
  assert.equal(switchbotConfig({}), null);
  const config = switchbotConfig({ SWITCHBOT_TOKEN: TOKEN, SWITCHBOT_SECRET: SECRET, SWITCHBOT_THERMOMETERS: "Thermo 1=C1A2B3C4D5E6, Floor 2=D1E2F3A4B5C6,bad<name>=X1Y2Z3W4,Empty=" });
  assert.deepEqual([...config.thermometers], [["Thermo 1", "C1A2B3C4D5E6"], ["Floor 2", "D1E2F3A4B5C6"]]);
});

test("signs like SwitchBot: base64 HMAC-SHA256 of token + time + nonce", () => {
  const headers = switchbotHeaders(TOKEN, SECRET, 1762000000000, "nonce-1");
  assert.equal(headers.sign, createHmac("sha256", SECRET).update(`${TOKEN}1762000000000nonce-1`).digest("base64"));
  assert.equal(headers.Authorization, TOKEN);
  assert.equal(headers.t, "1762000000000");
  assert.equal(headers.nonce, "nonce-1");
});

test("reads a thermometer status; refuses errors and impossible numbers", () => {
  assert.deepEqual(readingFromStatus({ statusCode: 100, body: { deviceId: "C1", deviceType: "Meter", temperature: 26.5, humidity: 89 }, message: "success" }), { temperatureC: 26.5, humidityPct: 89 });
  assert.equal(readingFromStatus({ statusCode: 190, body: {} }), null);
  assert.equal(readingFromStatus({ statusCode: 100, body: { temperature: 120 } }), null);
  assert.equal(readingFromStatus({ statusCode: 100, body: { temperature: 25, humidity: 140 } }), null);
  assert.deepEqual(readingFromStatus({ statusCode: 100, body: { temperature: 25 } }), { temperatureC: 25, humidityPct: null });
});

test("device list keeps only thermometers", () => {
  const list = thermometersFromDeviceList({ statusCode: 100, body: { deviceList: [
    { deviceId: "C1", deviceName: "Smart Thermometer 1", deviceType: "MeterPlus" },
    { deviceId: "B1", deviceName: "Curtain", deviceType: "Curtain" },
    { deviceId: "C2", deviceName: "Outdoor", deviceType: "WoIOSensor" },
  ] } });
  assert.deepEqual(list.map((d) => d.deviceId), ["C1", "C2"]);
});

test("intake from other bridges is strict", () => {
  const good = { readings: [{ sensor: "Thermo 1", readAt: "2026-11-02T06:15:00-04:00", temperatureC: 28.4, humidityPct: 81 }] };
  assert.deepEqual(readIntakeBody(good), [{ sensor: "Thermo 1", readAt: new Date("2026-11-02T10:15:00Z"), temperatureC: 28.4, humidityPct: 81 }]);
  assert.equal(readIntakeBody({ ...good, wifi: "x" }), null);
  assert.equal(readIntakeBody({ readings: [{ ...good.readings[0], deviceMac: "aa" }] }), null);
  assert.equal(readIntakeBody({ readings: [{ ...good.readings[0], readAt: "yesterday" }] }), null);
  assert.equal(readIntakeBody({ readings: [{ ...good.readings[0], readAt: "2026-11-02T06:15:00" }] }), null);
  assert.equal(readIntakeBody({ readings: [{ ...good.readings[0], temperatureC: "28" }] }), null);
  assert.equal(readIntakeBody({ readings: [] }), null);
  assert.equal(readIntakeBody({ readings: Array.from({ length: 501 }, () => good.readings[0]) }), null);
});
