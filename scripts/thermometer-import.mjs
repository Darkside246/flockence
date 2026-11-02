#!/usr/bin/env node
// Import a thermometer app's CSV export into Flockence (docs/ORIYA_LINK.md, 2026-11-02).
//
//   node --env-file=.env scripts/thermometer-import.mjs "D:\path\Smart Thermometer 1_export_202611010054.csv" "Thermo 1"
//
// The second argument is the farm's own name for this thermometer (letters, numbers, spaces, . _ -); it is what
// Oriya sees. Times in the file are read as the farm's clock (FARM_UTC_OFFSET, default -04:00). Readings already
// imported are skipped, so running it twice is safe. Prints counts only, never the readings.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { farmOffset, parseThermometerCsv, validSensorName } from "../lib/climate.mjs";

const [file, sensorArg] = process.argv.slice(2);
if (!file || !sensorArg) {
  console.error('Usage: node --env-file=.env scripts/thermometer-import.mjs "<export.csv>" "<thermometer name>"');
  process.exit(2);
}
const sensor = sensorArg.trim();
if (!validSensorName(sensor)) { console.error("The thermometer name may only use letters, numbers, spaces, dots, dashes and underscores (up to 40)."); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is missing. Run it with: node --env-file=.env scripts/thermometer-import.mjs ..."); process.exit(2); }

let text;
try { text = readFileSync(file, "utf8"); } catch { console.error("That file could not be opened. Check the path (put it in quotes if it has spaces)."); process.exit(2); }
if (text.length > 50 * 1024 * 1024) { console.error("That file is larger than 50 MB; split it first."); process.exit(2); }

const offset = farmOffset(process.env);
const parsed = parseThermometerCsv(text, offset);
if (parsed.error === "COLUMNS_NOT_FOUND") { console.error("No time and temperature columns were found in that file. Send Claude the first line of the file (the column names only)."); process.exit(1); }
if (!parsed.readings.length) { console.error("No readings could be read from that file."); process.exit(1); }

const prisma = new PrismaClient();
const farmId = process.env.FARM_ID || "default-farm";
try {
  if (!(await prisma.farm.findUnique({ where: { id: farmId }, select: { id: true } }))) { console.error("Start Flockence once first, so the farm exists."); process.exit(1); }
  let added = 0;
  for (let i = 0; i < parsed.readings.length; i += 1000) {
    const chunk = parsed.readings.slice(i, i + 1000);
    const result = await prisma.thermometerReading.createMany({
      data: chunk.map((r) => ({ farmId, sensor, readAt: r.readAt, temperatureC: r.temperatureC, humidityPercent: r.humidityPct, source: "CSV" })),
      skipDuplicates: true,
    });
    added += result.count;
  }
  const times = parsed.readings.map((r) => r.readAt.getTime());
  console.log(JSON.stringify({
    thermometer: sensor, read: parsed.readings.length, added, alreadyThere: parsed.readings.length - added, unreadableRows: parsed.skipped,
    from: new Date(Math.min(...times)).toISOString(), to: new Date(Math.max(...times)).toISOString(), farmClock: offset,
  }));
} catch (error) {
  // Short and plain: never the connection string or the readings.
  const name = error?.constructor?.name ?? "Error";
  console.error(name === "PrismaClientInitializationError"
    ? "The database could not be reached. Is Docker Desktop running and the flockence-postgres-dev container started, and is DATABASE_URL in .env right?"
    : /thermometerReading|does not exist/i.test(String(error?.message))
      ? "The thermometer table is not in the database yet. Run: npx prisma db push   (or start Flockence with -Rebuild), then import again."
      : `The import stopped (${name}). Nothing more was added; running it again is safe.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
