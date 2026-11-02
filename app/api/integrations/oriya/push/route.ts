import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pushToOriya } from "@/lib/oriya";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_FARM_ID, enterFarm } from "@/lib/farm-scope";

export const runtime = "nodejs";

/**
 * The scheduled flock check (scripts/oriya-push.mjs, run by cron on the Flockence server). Needs ORIYA_PUSH_TOKEN as
 * a Bearer token; sends today's numbers to Oriya and, when asked, pictures from the allowed cameras.
 *   ?pictures=none | thumbnail | fresh | auto
 *     fresh wakes the cameras and uses battery; auto follows the schedule (dawn every 15 min, midday every 30,
 *     otherwise hourly, sooner when Oriya asks, never past ORIYA_DAILY_LIVE_VIEWS a day) and sends the numbers
 *     every 10 minutes. Run auto every minute (scripts/oriya-watch.mjs, or cron).
 *   ?house=House A
 */
function authorized(request: Request) {
  const configured = process.env.ORIYA_PUSH_TOKEN?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (configured.length < 24 || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(configured), b = Buffer.from(header.slice(7).trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // The push token belongs to this install's own farm.
  enterFarm(DEFAULT_FARM_ID);
  const limit = await checkRateLimit("oriya:push", 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const url = new URL(request.url);
  const pictures = url.searchParams.get("pictures") ?? "thumbnail";
  if (!["none", "thumbnail", "fresh", "auto"].includes(pictures)) return NextResponse.json({ error: "INVALID_PICTURES" }, { status: 400 });
  const house = (url.searchParams.get("house") ?? "Main").trim();
  if (!/^[A-Za-z0-9_. -]{1,40}$/.test(house)) return NextResponse.json({ error: "INVALID_HOUSE" }, { status: 400 });
  const outcome = await pushToOriya({ house, pictures: pictures as "none" | "thumbnail" | "fresh" | "auto" });
  return NextResponse.json(outcome, { status: "error" in outcome ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
