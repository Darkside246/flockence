import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { blinkConfigured } from "@/lib/blink-sidecar";
import { farmLinkConfig } from "@/lib/oriya-farm-link";
import { oriyaLinkConfig } from "@/lib/oriya-link.mjs";

// Read-only connection status for the Settings Centre. It reports only whether each integration is set up,
// never an address, key or secret. Owners and managers only.
export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const oriya = Boolean(await farmLinkConfig().catch(() => null)) || Boolean(oriyaLinkConfig(process.env));
  return NextResponse.json({
    oriya,
    cameras: blinkConfigured(),
    thermometers: Boolean(process.env.SWITCHBOT_TOKEN && process.env.SWITCHBOT_SECRET) || Boolean(process.env.THERMOMETER_PUSH_TOKEN),
    weather: Boolean(process.env.WEATHER_API_KEY),
  });
}
