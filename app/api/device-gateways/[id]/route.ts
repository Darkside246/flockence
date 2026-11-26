import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { z } from "zod";
import { boundedBody, gatewayResponse, isGatewayOrigin } from "@/lib/camera-gateway-http";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { deviceGatewayEnabled, deviceUploadAllowed, parseDeviceToken, removeDeviceLink, uploadDeviceState } from "@/lib/device-gateway";
import { deviceGatewayId, deviceReadings, MAX_DEVICE_BODY, validObservationTime } from "@/lib/device-readings";
import { runAsFarm } from "@/lib/farm-scope";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const observation = z.strictObject({ observedAt: z.string().refine((value) => validObservationTime(value)), devices: deviceReadings });
const unavailable = () => gatewayResponse({ error: "Device readings are temporarily unavailable." }, 503);
const unauthorized = () => gatewayResponse({ error: "Device upload is unauthorized." }, 401);
const notFound = () => gatewayResponse({ error: "Device gateway not found." }, 404);

export async function DELETE(request: Request, context: Context) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isGatewayOrigin(request)) return gatewayResponse({ error: "Open Devices in Flockence to remove a gateway." }, 403);
  const { id } = await context.params;
  if (!deviceGatewayEnabled() || !deviceGatewayId.test(id)) return notFound();
  try {
    const result = await removeDeviceLink(id);
    return result.count ? gatewayResponse({ removed: true }) : notFound();
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  const credential = parseDeviceToken(request.headers.get("authorization"), id);
  if (!credential) return unauthorized();
  if (!deviceGatewayEnabled()) return unavailable();
  if (request.headers.get("content-type") !== "application/json") {
    return gatewayResponse({ error: "Device readings must be JSON." }, 415);
  }
  try {
    const raw = await boundedBody(request, MAX_DEVICE_BODY);
    if (!raw) return gatewayResponse({ error: "Device uploads may be at most 12 KiB." }, 413);
    const input = observation.safeParse(JSON.parse(raw.toString("utf8")));
    if (!input.success) return gatewayResponse({ error: "Invalid readings or observation time." }, 400);
    const { observedAt, devices } = input.data;
    return await runAsFarm(credential.farmId, async () => {
      if (!(await deviceUploadAllowed(id, credential.token))) return unauthorized();
      const locked = await premiumFeatureResponse();
      if (locked) return locked;
      const result = await uploadDeviceState(id, credential.token, observedAt, devices);
      if (result === "unauthorized") return unauthorized();
      if (result === "stale") return gatewayResponse({ error: "These readings are older than the current readings." }, 409);
      if (result === "limited") {
        const response = gatewayResponse({ error: "Wait before sending more readings." }, 429);
        response.headers.set("Retry-After", "60");
        return response;
      }
      return gatewayResponse({ observedAt }, 201);
    });
  } catch (error) {
    if (error instanceof SyntaxError) return gatewayResponse({ error: "Invalid device readings." }, 400);
    return unavailable();
  }
}
