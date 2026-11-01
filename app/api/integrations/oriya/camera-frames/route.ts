import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { claimOriyaRequestId, framesFromCamera } from "@/lib/oriya";
import { oriyaLinkConfig, readFrameRequest, verifyOriyaSignature } from "@/lib/oriya-link.mjs";

export const runtime = "nodejs";

/**
 * Oriya asks for pictures from one camera ("check camera 1 now"). Signed with the farm's link secret over the exact
 * body, within 5 minutes, each request id once, only cameras listed in ORIYA_CAMERAS, at most 10 a minute. Returns
 * fresh pictures a few seconds apart; never a camera address or token. See docs/ORIYA_LINK.md.
 */
export async function POST(request: Request) {
  const config = oriyaLinkConfig(process.env);
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
  return NextResponse.json({ occurredAt: frames.occurredAt, kind: "LIVE_VIEW", frames: frames.frames }, { headers: { "Cache-Control": "no-store" } });
}
