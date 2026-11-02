#!/usr/bin/env node
// Lists your SwitchBot thermometers so you can fill in SWITCHBOT_THERMOMETERS in .env (docs/ORIYA_LINK.md).
//
//   node scripts/switchbot-devices.mjs
//
// Reads SWITCHBOT_TOKEN and SWITCHBOT_SECRET from .env, asks SwitchBot's cloud for the device list, and prints each
// thermometer's id, name and type. Prints nothing else; the token and secret are never shown.
import { readFileSync } from "node:fs";
import { SWITCHBOT_API, switchbotConfig, switchbotHeaders, thermometersFromDeviceList } from "../lib/switchbot.mjs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
  } catch { return ""; }
}

const config = switchbotConfig({ SWITCHBOT_TOKEN: env("SWITCHBOT_TOKEN"), SWITCHBOT_SECRET: env("SWITCHBOT_SECRET") });
if (!config) { console.error("Put SWITCHBOT_TOKEN and SWITCHBOT_SECRET in .env first (SwitchBot app > Profile > Preferences > About > tap App Version 10 times > Developer Options)."); process.exit(2); }
let response;
try {
  response = await fetch(`${SWITCHBOT_API}/v1.1/devices`, { headers: switchbotHeaders(config.token, config.secret), redirect: "error", signal: AbortSignal.timeout(15_000) });
} catch { console.error("SwitchBot's cloud did not answer. Check this PC's internet."); process.exit(1); }
const json = await response.json().catch(() => null);
if (response.status === 401 || json?.statusCode === 401) { console.error("SwitchBot refused the token or secret. Copy them again from the SwitchBot app."); process.exit(1); }
const list = thermometersFromDeviceList(json);
if (!list.length) { console.error("No thermometers found. They need a SwitchBot Hub and Cloud Services turned on for each one in the SwitchBot app."); process.exit(1); }
for (const d of list) console.log(`${d.deviceId}  ${d.type}  ${d.name}`);
console.log(`\nPut them in .env with your own short names, for example:\nSWITCHBOT_THERMOMETERS="Thermo 1=${list[0].deviceId}${list[1] ? `,Floor 2=${list[1].deviceId}` : ""}"`);
