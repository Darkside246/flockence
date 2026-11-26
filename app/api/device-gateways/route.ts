import { boundedBody, gatewayResponse, isGatewayOrigin } from "@/lib/camera-gateway-http";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { createDeviceLink, deviceGatewayEnabled, listDeviceLinks } from "@/lib/device-gateway";
import { deviceName } from "@/lib/device-readings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const owner = session.user.role === "OWNER";
  if (!deviceGatewayEnabled()) return gatewayResponse({ enabled: false, owner, links: [] });
  try {
    return gatewayResponse({ enabled: true, owner, links: await listDeviceLinks() });
  } catch {
    return gatewayResponse({ error: "Device readings are temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isGatewayOrigin(request)) return gatewayResponse({ error: "Open Devices in Flockence to link a gateway." }, 403);
  if (!deviceGatewayEnabled()) return gatewayResponse({ error: "Device gateway setup is unavailable." }, 503);

  try {
    const raw = await boundedBody(request, 1024);
    const body = raw ? JSON.parse(raw.toString("utf8")) : null;
    const name = deviceName.safeParse(body?.name);
    if (!name.success) return gatewayResponse({ error: "Enter a gateway name of up to 48 characters." }, 400);
    const link = await createDeviceLink(name.data);
    return link ? gatewayResponse(link, 201) : gatewayResponse({ error: "You can link up to four gateways per farm." }, 409);
  } catch (error) {
    if (error instanceof SyntaxError) return gatewayResponse({ error: "Invalid gateway setup." }, 400);
    return gatewayResponse({ error: "Device gateway setup is temporarily unavailable." }, 503);
  }
}
