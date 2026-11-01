import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCurrentUser, currentUserOrRoleResponse } from "@/lib/current-user";

const prefix = "PENCFG::";
const keyFor = (userId: string, id: string) => `${prefix}${userId}::${id}`;
const parse = (value: string) => { try { return JSON.parse(value); } catch { return null; } };

function normalize(input: any, fallback: any = {}) {
  return {
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : fallback.name || "Pen",
    lengthM: Math.max(0, Number(input.lengthM ?? fallback.lengthM) || 0),
    widthM: Math.max(0, Number(input.widthM ?? fallback.widthM) || 0),
    housingMode: input.housingMode || fallback.housingMode || "OPEN_SIDED_HOT",
    orientation: input.orientation ?? fallback.orientation ?? "",
    feederPans: Math.max(0, Number(input.feederPans ?? fallback.feederPans) || 0),
    feederPanDiameterCm: Math.max(0, Number(input.feederPanDiameterCm ?? fallback.feederPanDiameterCm) || 33),
    chainFeederMeters: Math.max(0, Number(input.chainFeederMeters ?? fallback.chainFeederMeters) || 0),
    nipples: Math.max(0, Number(input.nipples ?? fallback.nipples) || 0),
    bellDrinkers: Math.max(0, Number(input.bellDrinkers ?? fallback.bellDrinkers) || 0),
    fans: Math.max(0, Number(input.fans ?? fallback.fans) || 0),
    fanCapacityM3H: Math.max(0, Number(input.fanCapacityM3H ?? fallback.fanCapacityM3H) || 0),
    heatSources: Math.max(0, Number(input.heatSources ?? fallback.heatSources) || 0),
    waterTankLitres: Math.max(0, Number(input.waterTankLitres ?? fallback.waterTankLitres) || 0),
    notes: input.notes ?? fallback.notes ?? "",
    active: input.active ?? fallback.active ?? true,
  };
}

async function getRows(user: { id: string; farmId: string }) {
  return prisma.setting.findMany({ where: { farmId: user.farmId, key: { startsWith: `${prefix}${user.id}::` } }, orderBy: { updatedAt: "desc" } });
}

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const rows = await getRows(user);
    return NextResponse.json(rows.flatMap((row) => {
      const data = parse(row.value);
      return data && typeof data === "object" ? [{ id: row.key.slice(keyFor(user.id, "").length), ...data }] : [];
    }));
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: "Unable to load pen configurations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
    if (access.response) return access.response;
    const user = access.user!;
    const input = await request.json();
    const rows = await getRows(user);
    const data = normalize(input);
    const duplicate = rows.find((row) => String(parse(row.value)?.name || "").trim().toLowerCase() === data.name.toLowerCase() && (!input.id || row.key !== keyFor(user.id, input.id)));
    if (duplicate) return NextResponse.json({ error: "A pen with that name already exists for this user." }, { status: 409 });
    const id = typeof input.id === "string" && input.id ? input.id : crypto.randomUUID();
    await prisma.setting.upsert({ where: { farmId_key: { farmId: user.farmId, key: keyFor(user.id, id) } }, create: { farmId: user.farmId, key: keyFor(user.id, id), value: JSON.stringify(data) }, update: { value: JSON.stringify(data) } });
    return NextResponse.json({ id, ...data });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save pen." }, { status: 500 });
  }
}
