import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { camerasBelongToThisFarm, cameraViewRoles } from "@/lib/camera-guard";
import { prisma } from "@/lib/prisma";
import { validSlots } from "@/lib/camera-slots.mjs";

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (access.response) return access.response;
  if (!camerasBelongToThisFarm()) return NextResponse.json({error:"Camera service is not configured for this farm."},{status:403});
  const {farmId,id} = access.user!;
  const row = await prisma.setting.findUnique({where:{farmId_key:{farmId,key:"CAMERA_WALL::"+id}}});
  return NextResponse.json(row ? JSON.parse(row.value) : [null,null,null,null], {headers:{"Cache-Control":"no-store"}});
}

export async function PUT(request: Request) {
  const access = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (access.response) return access.response;
  const slots = await request.json().catch(() => null);
  if (!validSlots(slots)) return NextResponse.json({error:"Choose each camera only once."},{status:400});
  if (!camerasBelongToThisFarm()) return NextResponse.json({error:"Camera service is not configured for this farm."},{status:403});
  const {farmId,id} = access.user!;
  const key = "CAMERA_WALL::"+id, value = JSON.stringify(slots);
  await prisma.setting.upsert({where:{farmId_key:{farmId,key}},create:{farmId,key,value},update:{value}});
  return NextResponse.json(slots);
}
