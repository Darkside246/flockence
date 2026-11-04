import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { authError, requireCurrentUser, currentUserOrRoleResponse } from "@/lib/current-user";

const reserved = ["ROUNDS::","DEVICE_PRIVATE::", "AUTH_", "PENCFG::", "PEN::", "FARM_PEN", "CAMERA_WALL::", "FARM_INVITE::"];
const publicSettingFilter = { NOT: reserved.map(prefix => ({key:{startsWith:prefix}})) };

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    await ensureFarm();
    const farm = await prisma.farm.findUnique({ where: { id: currentFarmId() } });
    const settings = await prisma.setting.findMany({ where: { farmId: currentFarmId(), ...publicSettingFilter }, orderBy: { key: "asc" } });
    return NextResponse.json({ farm, settings });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: "Unable to load settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
    if (access.response) return access.response;
    await ensureFarm();
    const input = await request.json();
    const updates = Array.isArray(input.settings) ? input.settings : [];
    for (const item of updates) {
      if (!item?.key) continue;
      const key = String(item.key);
      if (reserved.some(prefix => key.startsWith(prefix))) continue;
      await prisma.setting.upsert({ where: { farmId_key: { farmId: currentFarmId(), key } }, update: { value: String(item.value ?? "") }, create: { farmId: currentFarmId(), key, value: String(item.value ?? "") } });
    }
    if (input.farmName) await prisma.farm.update({ where: { id: currentFarmId() }, data: { name: String(input.farmName), currency: "BBD" } });
    return NextResponse.json(await prisma.setting.findMany({ where: { farmId: currentFarmId(), ...publicSettingFilter }, orderBy: { key: "asc" } }));
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save settings." }, { status: 400 });
  }
}
