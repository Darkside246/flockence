import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { feedStore, flockFeed } from "@/lib/feed-ledger";

/** Feed in the store (bought − put out + taken back), and per flock: put out, left, spilt, returned and eaten per day. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const batchId = new URL(request.url).searchParams.get("batchId");
  const farmId = currentFarmId();
  if (batchId && !(await prisma.batch.findFirst({ where: { id: batchId, farmId }, select: { id: true } }))) return NextResponse.json({ error: "Flock not found." }, { status: 404 });
  const result = await prisma.$transaction(async tx => ({ store: await feedStore(tx, farmId), flock: batchId ? await flockFeed(tx, batchId) : null }));
  return NextResponse.json(result);
}
