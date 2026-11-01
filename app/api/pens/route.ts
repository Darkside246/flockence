import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, requireCurrentUser, currentUserOrRoleResponse } from "@/lib/current-user";

const PREFIX = "PEN::";

function keyFor(userId: string, penId: string) {
  return `${PREFIX}${userId}::${penId}`;
}

function parseSetting(value: string) {
  try { return JSON.parse(value); } catch { return null; }
}

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const rows = await prisma.setting.findMany({
      where: { farmId: user.farmId, key: { startsWith: `${PREFIX}${user.id}::` } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(rows.map((row) => ({ id: row.key.slice(keyFor(user.id, "").length), ...parseSetting(row.value) })));
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
    if (!input.name || typeof input.name !== "string") return NextResponse.json({ error: "Pen name is required." }, { status: 400 });
    const penId = crypto.randomUUID();
    const value = {
      name: input.name.trim(),
      lengthM: Math.max(0, Number(input.lengthM) || 0),
      widthM: Math.max(0, Number(input.widthM) || 0),
      housingMode: input.housingMode || "OPEN_SIDED_HOT",
      orientation: input.orientation || "",
      feederPans: Math.max(0, Number(input.feederPans) || 0),
      feederPanDiameterCm: Math.max(0, Number(input.feederPanDiameterCm) || 0),
      chainFeederMeters: Math.max(0, Number(input.chainFeederMeters) || 0),
      nipples: Math.max(0, Number(input.nipples) || 0),
      bellDrinkers: Math.max(0, Number(input.bellDrinkers) || 0),
      fans: Math.max(0, Number(input.fans) || 0),
      fanCapacityM3H: Math.max(0, Number(input.fanCapacityM3H) || 0),
      heatSources: Math.max(0, Number(input.heatSources) || 0),
      waterTankLitres: Math.max(0, Number(input.waterTankLitres) || 0),
      notes: input.notes || "",
      active: true,
    };
    const existing = await prisma.setting.findUnique({ where: { farmId_key: { farmId: user.farmId, key: `${PREFIX}${user.id}::name::${value.name.toLowerCase()}` } } }).catch(() => null);
    if (existing) return NextResponse.json({ error: "A pen with that name already exists for this user." }, { status: 409 });
    await prisma.setting.create({ data: { farmId: user.farmId, key: keyFor(user.id, penId), value: JSON.stringify(value) } });
    await prisma.setting.create({ data: { farmId: user.farmId, key: `${PREFIX}${user.id}::name::${value.name.toLowerCase()}`, value: penId } });
    return NextResponse.json({ id: penId, ...value }, { status: 201 });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save pen." }, { status: 500 });
  }
}
