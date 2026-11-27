import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { recentAlerts } from "@/lib/vision-alerts";
import { reportPeople } from "@/lib/vision-daily-report";
import { accountPreferences } from "@/lib/account-preferences";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** The farm's recent Vision alerts and which owners and managers get alert emails (lib/vision-alerts.ts). */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  const [alerts, people] = await Promise.all([recentAlerts(), reportPeople()]);
  const withAlerts = await Promise.all(people.map(async (p) => ({ name: p.name, you: p.id === session.user.id, wantsAlerts: (await accountPreferences(session.user.farmId, p.id)).farmAlertEmail })));
  return NextResponse.json({ alerts, people: withAlerts }, { headers });
}
