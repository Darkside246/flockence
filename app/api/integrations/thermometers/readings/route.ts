import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { readIntakeBody } from "@/lib/switchbot.mjs";
import { storeReadings } from "@/lib/thermometers";
import { DEFAULT_FARM_ID, enterFarm } from "@/lib/farm-scope";

export const runtime = "nodejs";

/**
 * Live thermometer readings from any thermometer bridge (docs/ORIYA_LINK.md, 2026-11-02). Needs THERMOMETER_PUSH_TOKEN
 * (24+ characters) as a Bearer token. Body: {"readings":[{"sensor":"Thermo 1","readAt":"2026-11-02T06:15:00-04:00",
 * "temperatureC":28.4,"humidityPct":81}]} - at most 500, strict (any other field refuses the whole request), 64 KB,
 * 30 requests a minute. Repeats of the same thermometer and time are ignored.
 */
function authorized(request: Request) {
  const configured = process.env.THERMOMETER_PUSH_TOKEN?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (configured.length < 24 || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(configured), b = Buffer.from(header.slice(7).trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // The thermometer token belongs to this install's own farm.
  enterFarm(DEFAULT_FARM_ID);
  const limit = await checkRateLimit("thermometers:intake", 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const raw = await request.text();
  if (raw.length === 0 || raw.length > 64 * 1024) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  const readings = readIntakeBody(body);
  if (!readings) return NextResponse.json({ error: "INVALID_READINGS" }, { status: 400 });
  const added = await storeReadings(readings, "API");
  return NextResponse.json({ received: readings.length, added }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
