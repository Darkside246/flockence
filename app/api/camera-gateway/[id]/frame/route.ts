import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { cameraViewRoles, hardenCameraHeaders } from "@/lib/camera-guard";
import { MAX_FRAME_BYTES, gatewayEnabled, gatewayIdPattern, gatewayUploadAllowed, getGatewayFrame, parseGatewayToken, removeGateway, saveGatewayFrame } from "@/lib/camera-gateway";
import { boundedBody, gatewayResponse, isGatewayOrigin } from "@/lib/camera-gateway-http";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { runAsFarm } from "@/lib/farm-scope";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const unavailable = () => gatewayResponse({ error: "Private camera feeds are unavailable." }, 503);
const notFound = () => gatewayResponse({ error: "Camera feed not found." }, 404);
const denied = () => gatewayResponse({ error: "Camera upload is unauthorized." }, 401);

export async function GET(request: Request, ctx: Context) {
  const session = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const { id } = await ctx.params;
  if (!gatewayIdPattern.test(id) || !gatewayEnabled()) return notFound();
  try {
    const photo = await getGatewayFrame(id);
    if (!photo) return notFound();
    const headers = new Headers({ "Content-Type": "image/jpeg" });
    hardenCameraHeaders(headers);
    return new Response(photo, { headers });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request, ctx: Context) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isGatewayOrigin(request)) return gatewayResponse({ error: "Use the Flockence Cameras page." }, 403);
  const { id } = await ctx.params;
  if (!gatewayIdPattern.test(id) || !gatewayEnabled()) return notFound();
  try {
    const result = await removeGateway(id);
    return result.count ? gatewayResponse({ removed: true }) : notFound();
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request, ctx: Context) {
  const { id } = await ctx.params;
  if (!gatewayIdPattern.test(id)) return denied();
  const credential = parseGatewayToken(request.headers.get("authorization"), id);
  if (!credential) return denied();
  if (!gatewayEnabled()) return unavailable();
  const time = request.headers.get("x-captured-at") ?? "";
  const captured = Date.parse(time);
  const now = Date.now();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(time)
    || !Number.isFinite(captured) || captured > now + 60_000 || captured < now - 10 * 60_000
    || new Date(captured).toISOString() !== time) {
    return gatewayResponse({ error: "Use a current UTC capture timestamp." }, 400);
  }
  if (request.headers.get("content-type") !== "image/jpeg") {
    return gatewayResponse({ error: "Send a JPEG image." }, 415);
  }
  try {
    return await runAsFarm(credential.farmId, async () => {
      if (!(await gatewayUploadAllowed(id, credential.token))) return denied();
      const locked = await premiumFeatureResponse();
      if (locked) return locked;
      const limit = await checkRateLimit("camera-frame:" + credential.farmId + ":" + id, 8, 60_000);
      if (!limit.allowed) {
        const response = gatewayResponse({ error: "Camera upload limit reached." }, 429);
        response.headers.set("Retry-After", String(limit.retryAfterSeconds));
        return response;
      }
      const bytes = await boundedBody(request, MAX_FRAME_BYTES);
      if (!bytes) return gatewayResponse({ error: "JPEG images may be at most 256 KiB." }, 413);
      if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
        return gatewayResponse({ error: "The upload is not a JPEG image." }, 415);
      }
      const result = await saveGatewayFrame(id, credential.token, time, bytes);
      if (result === "unauthorized") return denied();
      if (result === "stale") return gatewayResponse({ error: "A newer or duplicate frame already exists." }, 409);
      return gatewayResponse({ capturedAt: time }, 201);
    });
  } catch {
    return unavailable();
  }
}
