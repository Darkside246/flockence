import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { prisma } from "@/lib/prisma";
import { peopleSettings, savePeopleSettings } from "@/lib/vision-people";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** The people timeline and how long it is kept (lib/vision-people.ts). Read by owners and managers; changed by owners. */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json({ settings: await peopleSettings(), canChange: session.user.role === "OWNER" }, { headers });
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const parsed = z.strictObject({ timeline: z.boolean(), keepDays: z.number().int().min(1).max(90) }).safeParse(await readAccountForm(request));
  if (!parsed.success) return NextResponse.json({ error: "Choose on or off and keep it 1 to 90 days." }, { status: 400, headers });
  await ensureFarm();
  const before = await peopleSettings();
  await savePeopleSettings(parsed.data);
  await prisma.auditLog.create({ data: {
    farmId: session.user.farmId, userId: session.user.id, action: "VISION_PEOPLE_SETTINGS", entity: "Setting", entityId: "VISION_PEOPLE",
    beforeJson: JSON.stringify(before), afterJson: JSON.stringify(parsed.data),
  } }).catch(() => undefined);
  return NextResponse.json({ settings: parsed.data }, { headers });
}
