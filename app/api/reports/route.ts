import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, batchSummary, ensureFarm } from "@/lib/operations";
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;await ensureFarm();const batches=await prisma.batch.findMany({where:{farmId:currentFarmId()},orderBy:{startDate:"desc"}});const summaries=await Promise.all(batches.map(b=>batchSummary(b.id)));return NextResponse.json(summaries.filter(Boolean));}
