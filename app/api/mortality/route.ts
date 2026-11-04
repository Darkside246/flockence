import {recordMortality} from "@/lib/record-mortality";
import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ensureFarm, currentFarmId } from "@/lib/operations";
import { lockFlockOperations } from "@/lib/poultry-lock";
import { calculateLiveBirdsAtDate, isCalendarDateNotFuture, isWithinInitialFlockCount, parseCalendarDate } from "@/lib/poultry-metrics.mjs";


export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const events = await prisma.mortalityEvent.findMany({
    where: { batch: { farmId: currentFarmId() } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { batch: true },
  });
  return NextResponse.json(events);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;

  return recordMortality(await request.json());
}
