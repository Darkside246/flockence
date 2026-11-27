import { SETTINGS_ROLES } from "@/lib/farm-roles";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { authError, requireCurrentUser, currentUserOrRoleResponse } from "@/lib/current-user";
import { farmPreferenceKeys, isFarmPreferenceKey } from "@/lib/farm-preferences";
import { isTrustedAppOrigin } from "@/lib/request-origin";

const headers = { "Cache-Control": "private, no-store" };
const publicSettingFilter = { key: { in: farmPreferenceKeys } };
const updatesSchema = z.object({
  farmName: z.string().trim().min(2).max(120).optional(),
  settings: z.array(z.object({
    key: z.string().refine(isFarmPreferenceKey),
    value: z.string().trim().max(120),
    previous: z.string().max(120).nullable().optional(),
  })).max(farmPreferenceKeys.length).default([]),
});

function validValue(key: string, value: string) {
  if (key === "weather_location_name") return true;
  if (key === "weather_latitude" || key === "weather_longitude") {
    const limit = key === "weather_latitude" ? 90 : 180;
    return value === "" || (/^-?\d+(\.\d+)?$/.test(value) && Math.abs(Number(value)) <= limit);
  }
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 9999999;
}

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    await ensureFarm();
    const farm = await prisma.farm.findUnique({ where: { id: user.farmId } });
    const settings = await prisma.setting.findMany({ where: { farmId: user.farmId, ...publicSettingFilter }, orderBy: { key: "asc" } });
    return NextResponse.json({ farm, settings }, { headers });
  } catch (error) {
    const response = authError(error);
    return response ?? NextResponse.json({ error: "Unable to load settings." }, { status: 500, headers });
  }
}

export async function PUT(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const input = updatesSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || new Set(input.data.settings.map(({ key }) => key)).size !== input.data.settings.length
    || input.data.settings.some(({ key, value }) => !validValue(key, value))) {
    return NextResponse.json({ error: "Check the settings values and try again." }, { status: 400, headers });
  }
  try {
    await ensureFarm();
    const farmId = currentFarmId();
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Farm" WHERE id = ${farmId} FOR UPDATE`;
      for (const { key, previous } of input.data.settings) {
        if (previous === undefined) continue;
        const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key } }, select: { value: true } });
        if ((row?.value ?? null) !== previous) return false;
      }
      for (const { key, value } of input.data.settings) {
        await tx.setting.upsert({ where: { farmId_key: { farmId, key } }, update: { value }, create: { farmId, key, value } });
      }
      if (input.data.farmName) await tx.farm.update({ where: { id: farmId }, data: { name: input.data.farmName } });
      return true;
    });
    if (!changed) return NextResponse.json({ error: "Settings changed elsewhere." }, { status: 409, headers });
    return NextResponse.json(await prisma.setting.findMany({ where: { farmId, ...publicSettingFilter }, orderBy: { key: "asc" } }), { headers });
  } catch {
    return NextResponse.json({ error: "Could not save settings." }, { status: 503, headers });
  }
}
