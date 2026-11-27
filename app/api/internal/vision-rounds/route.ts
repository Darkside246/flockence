import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runVisionRounds } from "@/lib/vision-schedule";

export const runtime = "nodejs";
export const maxDuration = 900;
const headers = { "Cache-Control": "no-store" };

/**
 * Automatic camera vision round, called by flockence-vision-rounds.timer on the VPS (ops/systemd). Only a caller with
 * VISION_ROUNDS_TOKEN may start a round; every farm's own switch, plan, quiet hours and daily limit still apply.
 */
export async function POST(request: Request) {
  const expected = process.env.VISION_ROUNDS_TOKEN ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(expected)) return NextResponse.json({ error: "Automatic camera rounds are not set up on this server." }, { status: 503, headers });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(given), digest(expected))) return NextResponse.json({ error: "Not allowed." }, { status: 401, headers });
  const results = await runVisionRounds();
  return NextResponse.json({ farms: results.length, results }, { headers });
}
