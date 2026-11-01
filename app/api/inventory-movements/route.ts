import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batchId = new URL(request.url).searchParams.get("batchId");
  const productId = new URL(request.url).searchParams.get("productId");
  const rows = await prisma.inventoryMovement.findMany({
    where: { farmId: FARM_ID, ...(batchId ? { batchId } : {}), ...(productId ? { productId } : {}) },
    orderBy: { date: "desc" },
    take: 500,
  });
  return NextResponse.json(rows);
}
