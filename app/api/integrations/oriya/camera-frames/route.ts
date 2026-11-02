import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { claimOriyaRequestId, currentClimate, framesFromCamera, referenceFor } from "@/lib/oriya";
import { readFrameRequest, verifyOriyaSignature } from "@/lib/oriya-link.mjs";
import { DEFAULT_FARM_ID, enterFarm } from "@/lib/farm-scope";
import { farmLinkConfig } from "@/lib/oriya-farm-link";

export const runtime = "nodejs";

/**
 * Oriya asks for pictures from one camera ("check camera 1 now"). Signed with the farm's link secret over the exact
 * body, within 5 minutes, each request id once, only cameras listed in ORIYA_CAMERAS, at most 10 a minute. Returns
 * fresh pictures a few seconds apart; never a camera address or token. See docs/ORIYA_LINK.md.
 */
export async function POST(request: Request) {
  // Which farm Oriya is asking for (X-Flockence-Farm, sent for farms Oriya set up); the signature must then match that
  // farm's own link secret, so naming another farm gets nowhere. Without it, this install's own farm.
  const named = request.headers.get("x-flockence-farm") ?? "";
  enterFarm(/^[A-Za-z0-9_-]{3,64}$/.test(named) ? named : DEFAULT_FARM_ID);
  const config = await farmLinkConfig();
  if (!config) return NextResponse.json({ error: "LINK_NOT_SET_UP" }, { status: 503 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length === 0 || raw.length > 4096) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const signed = verifyOriyaSignature(config.secret, request.headers.get("x-oriya-timestamp"), request.headers.get("x-oriya-signature"), raw);
  if (!signed.ok) return NextResponse.json({ error: signed.reason }, { status: 401 });
  const limit = await checkRateLimit("oriya:camera-frames", 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  const ask = readFrameRequest(body);
  if (!ask) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  if (!(await claimOriyaRequestId(ask.requestId))) return NextResponse.json({ error: "ALREADY_RECEIVED" }, { status: 409 });
  const frames = await framesFromCamera(ask.camera, ask.frames, ask.secondsApart, true);
  if (!frames.ok) return NextResponse.json({ error: frames.reason }, { status: frames.reason === "CAMERA_NOT_ALLOWED" ? 404 : 502 });
  // With the earlier picture from this camera and the thermometers, so Oriya can compare and knows the conditions.
  const [reference, climate] = await Promise.all([referenceFor(ask.camera, frames.frames), currentClimate()]);
  return NextResponse.json({
    occurredAt: frames.occurredAt, kind: "LIVE_VIEW", frames: frames.frames, ...(reference ? { reference } : {}), ...(climate.length ? { climate } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
}
