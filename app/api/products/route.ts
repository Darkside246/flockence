import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;await ensureFarm();return NextResponse.json(await prisma.product.findMany({where:{farmId:currentFarmId()},orderBy:{name:"asc"}}));}
export async function POST(request:Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;try{await ensureFarm();const i=await request.json();if(!i.name||!i.unit)return NextResponse.json({error:"Product name and unit are required."},{status:400});return NextResponse.json(await prisma.product.create({data:{farmId:currentFarmId(),name:i.name,unit:i.unit,defaultPriceMinor:i.defaultPriceMinor??null}}),{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Could not create product."},{status:400});}}
