import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pushToOriya } from "@/lib/oriya";

export const runtime = "nodejs";

/**
 * The scheduled flock check (scripts/oriya-push.mjs, run by cron on the Flockence server). Needs ORIYA_PUSH_TOKEN as
 * a Bearer token; sends today's numbers to Oriya and, when asked, pictures from the allowed cameras.
 *   ?pictures=none | thumbnail | fresh    (fresh wakes the cameras and uses battery: every 30-60 minutes at most)
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
  const url = new URL(request.url);
  const pictures = url.searchParams.get("pictures") ?? "thumbnail";
  if (!["none", "thumbnail", "fresh"].includes(pictures)) return NextResponse.json({ error: "INVALID_PICTURES" }, { status: 400 });
  const house = (url.searchParams.get("house") ?? "Main").trim();
  if (!/^[A-Za-z0-9_. -]{1,40}$/.test(house)) return NextResponse.json({ error: "INVALID_HOUSE" }, { status: 400 });
  const outcome = await pushToOriya({ house, pictures: pictures as "none" | "thumbnail" | "fresh" });
  return NextResponse.json(outcome, { status: "error" in outcome ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
