import { z } from "zod";
import { accountClientIp, accountRateLimitResponse } from "@/lib/account-form-security";
import { cameraViewRoles } from "@/lib/camera-guard";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { runAsFarm } from "@/lib/farm-scope";
import { boundedBody, gatewayResponse, isGatewayOrigin } from "@/lib/camera-gateway-http";
import {
  createWyzeBridgeLink, gatewayEnabled, parseWyzeBridgeToken, revokeWyzeBridgeLink,
  syncWyzeBridge, wyzeBridgeAllowed, wyzeBridgeStatus,
} from "@/lib/camera-gateway";

export const runtime = "nodejs";
const unavailable = () => gatewayResponse({ error: "Wyze bridge is temporarily unavailable." }, 503);
const denied = () => gatewayResponse({ error: "Wyze bridge is unauthorized." }, 401);
const originError = () => gatewayResponse({ error: "Open Camera connections in Flockence." }, 403);

const discovery = z.strictObject({
  cameras: z.array(z.strictObject({
    device: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().regex(/^[^\p{C}]{1,48}$/u),
  })).max(6).refine(cameras => new Set(cameras.map(camera => camera.device)).size === cameras.length),
});

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  if (!gatewayEnabled()) return gatewayResponse({ enabled: false });
  try {
    return gatewayResponse({ enabled: true, owner: session.user.role === "OWNER", ...await wyzeBridgeStatus() });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isGatewayOrigin(request)) return originError();
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  if (!gatewayEnabled()) return unavailable();
  try {
    const limit = await accountRateLimitResponse("wyze-link:" + session.user.farmId, 6, 15 * 60_000, "Too many bridge changes. Try again later.");
    if (limit) return limit;
    return gatewayResponse(await createWyzeBridgeLink(), 201);
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isGatewayOrigin(request)) return originError();
  if (!gatewayEnabled()) return unavailable();
  try {
    await revokeWyzeBridgeLink();
    return gatewayResponse({ disconnected: true });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request) {
  const credential = parseWyzeBridgeToken(request.headers.get("Authorization"));
  if (!credential) return denied();
  if (!gatewayEnabled()) return unavailable();
  try {
    const ip = accountClientIp(request) || "unknown";
    const ipLimit = await accountRateLimitResponse("wyze-discover-ip:" + ip, 45, 60_000, "Too many discovery attempts.");
    if (ipLimit) return ipLimit;
    return await runAsFarm(credential.farmId, async () => {
      if (!await wyzeBridgeAllowed(credential.token)) return denied();
      const locked = await premiumFeatureResponse();
      if (locked) return locked;
      const limit = await accountRateLimitResponse("wyze-discover:" + credential.farmId, 12, 60_000, "Camera discovery is rate limited.");
      if (limit) return limit;
      const body = await boundedBody(request, 4096);
      if (!body) return gatewayResponse({ error: "Camera inventory is too large." }, 413);
      const parsed = discovery.safeParse(JSON.parse(body.toString("utf8")));
      if (!parsed.success) return gatewayResponse({ error: "Supply up to six unique camera identities." }, 400);
      const result = await syncWyzeBridge(credential.token, parsed.data.cameras);
      return result ? gatewayResponse(result) : denied();
    });
  } catch (error) {
    return error instanceof SyntaxError ? gatewayResponse({ error: "Invalid camera inventory." }, 400) : unavailable();
  }
}
