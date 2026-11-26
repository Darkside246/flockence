import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { cameraViewRoles } from "@/lib/camera-guard";
import { createGateway, gatewayEnabled, listGateways } from "@/lib/camera-gateway";
import { boundedBody, gatewayResponse, isGatewayOrigin } from "@/lib/camera-gateway-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const owner = session.user.role === "OWNER";
  if (!gatewayEnabled()) return gatewayResponse({ enabled: false, owner, feeds: [] });
  try {
    return gatewayResponse({ enabled: true, owner, feeds: await listGateways() });
  } catch {
    return gatewayResponse({ error: "Private camera feeds are temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  if (!isGatewayOrigin(request)) return gatewayResponse({ error: "Use the Flockence Cameras page." }, 403);
  if (!gatewayEnabled()) return gatewayResponse({ error: "Private camera feeds are unavailable." }, 503);
  try {
    const body = await boundedBody(request, 1024);
    const data = body ? JSON.parse(body.toString("utf8")) : null;
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    const brand = data?.brand;
    if (!/^[^\p{C}]{1,48}$/u.test(name) || (brand !== "wyze" && brand !== "network")) {
      return gatewayResponse({ error: "Enter a camera name and brand." }, 400);
    }
    const feed = await createGateway(name, brand);
    return feed ? gatewayResponse(feed, 201) : gatewayResponse({ error: "This farm supports six private snapshot feeds." }, 409);
  } catch (error) {
    if (error instanceof SyntaxError) return gatewayResponse({ error: "Invalid camera setup." }, 400);
    return gatewayResponse({ error: "Private camera feeds are temporarily unavailable." }, 503);
  }
}
