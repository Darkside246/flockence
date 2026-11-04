import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { withFarmPens, penKey } from "@/lib/farm-pens";
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


export async function GET(request: Request) {
  const access = await currentUserOrResponse(request);
  if (access.response) return access.response;
  return withFarmPens(access.user!.farmId, async (_tx, rows) =>
    NextResponse.json(rows.map(row => ({ ...normalize(JSON.parse(row.value)), id: row.key.slice(penKey.length) }))));
}

export async function POST(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const input = await request.json().catch(() => null);
  if (typeof input?.name !== "string" || !input.name.trim()) return NextResponse.json({error:"Pen name is required."},{status:400});
  const farmId = access.user!.farmId;
  return withFarmPens(farmId, async (tx, rows) => {
    const old = input.id && rows.find(row => row.key === penKey + input.id);
    if (input.id && !old) return NextResponse.json({error:"Pen no longer exists."},{status:404});
    const data = normalize(input, old ? JSON.parse(old.value) : {});
    if (rows.some(r => r !== old && JSON.parse(r.value).name.trim().toLowerCase() === data.name.toLowerCase()))
      return NextResponse.json({error:"That farm pen name is already in use."},{status:409});
    const id = old ? input.id : crypto.randomUUID();
    const key = penKey + id;
    await tx.setting.upsert({where:{farmId_key:{farmId,key}},create:{farmId,key,value:JSON.stringify(data)},update:{value:JSON.stringify(data)}});
    return NextResponse.json({id,...data});
  });
}

export async function DELETE(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const farmId = access.user!.farmId;
  const id = new URL(request.url).searchParams.get("id");
  return withFarmPens(farmId, async tx => {
    const result = await tx.setting.deleteMany({where:{farmId,key:penKey+id}});
    return result.count ? NextResponse.json({deleted:true}) : NextResponse.json({error:"Pen not found."},{status:404});
  });
}
