import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;await ensureFarm();return NextResponse.json(await prisma.recurringExpense.findMany({where:{farmId:currentFarmId()},orderBy:{nextDueDate:"asc"}}));}
export async function POST(request:Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;try{await ensureFarm();const i=await request.json();if(!i.name||!i.category||Number(i.amountMinor)<0||!i.nextDueDate)return NextResponse.json({error:"Name, category, amount and next due date are required."},{status:400});return NextResponse.json(await prisma.recurringExpense.create({data:{farmId:currentFarmId(),name:i.name,category:i.category,amountMinor:Number(i.amountMinor),frequency:i.frequency||"MONTHLY",nextDueDate:new Date(i.nextDueDate),allocationMethod:i.allocationMethod||"FARM_WIDE",active:i.active!==false}}),{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Could not create recurring expense."},{status:400});}}
