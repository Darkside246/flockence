import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runVisionRounds } from "@/lib/vision-schedule";
import { runDailyReports } from "@/lib/vision-daily-report";
import { runPeopleRetention } from "@/lib/vision-people";

export const runtime = "nodejs";
export const maxDuration = 900;
const headers = { "Cache-Control": "no-store" };

/**
 * Automatic camera vision round, called by flockence-vision-rounds.timer on the VPS (ops/systemd). Only a caller with
 * VISION_ROUNDS_TOKEN may start a round; every farm's own switch, plan, quiet hours and daily limit still apply.
 * The same round then sends any daily Vision email reports that are due (lib/vision-daily-report.ts).
 */
export async function POST(request: Request) {
  const expected = process.env.VISION_ROUNDS_TOKEN ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(expected)) return NextResponse.json({ error: "Automatic camera rounds are not set up on this server." }, { status: 503, headers });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(given), digest(expected))) return NextResponse.json({ error: "Not allowed." }, { status: 401, headers });
  const results = await runVisionRounds();
  const dailyReports = await runDailyReports().catch((error) => [{ farmId: "*", sent: 0, skipped: `error: ${error instanceof Error ? error.name : "unknown"}` }]);
  // People data past each farm's keep period (or all of it, when the timeline is off) is removed.
  const peopleRemoved = await runPeopleRetention().catch(() => 0);
  return NextResponse.json({ farms: results.length, results, dailyReports, peopleRemoved }, { headers });
}
