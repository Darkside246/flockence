import { SETTINGS_ROLES } from "@/lib/farm-roles";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { eggCountsOn, setEggCounts } from "@/lib/vision-egg-settings";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** Egg counts from pictures: off until the farm has checked them (lib/vision-egg-settings.ts). Owners and managers. */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json({ counts: await eggCountsOn() }, { headers });
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const parsed = z.strictObject({ counts: z.boolean() }).safeParse(await readAccountForm(request));
  if (!parsed.success) return NextResponse.json({ error: "Choose on or off." }, { status: 400, headers });
  await ensureFarm();
  await setEggCounts(parsed.data.counts);
  return NextResponse.json({ counts: parsed.data.counts }, { headers });
}
