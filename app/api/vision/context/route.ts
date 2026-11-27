import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { inspectionContext } from "@/lib/vision-context";
import { visionPens } from "@/lib/vision-pens";
import { visionCategories } from "@/lib/vision";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const id = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * "What Vision already knows": the farm facts that will go with a check of this kind, for this flock and pen
 * (lib/vision-context.ts), shown on the Farm Vision page before anything is sent. Reads only; no picture, no cost.
 */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "OTHER";
  const batchId = url.searchParams.get("batchId") || null;
  const penId = url.searchParams.get("penId") || null;
  if (!(visionCategories as readonly string[]).includes(category) || (batchId && !id.test(batchId)) || (penId && !id.test(penId))) {
    return NextResponse.json({ error: "Invalid choice." }, { status: 400, headers });
  }
  await ensureFarm();
  const [pen] = penId ? await visionPens(penId) : [];
  const context = await inspectionContext({ batchId, pen: pen ?? null, category });
  return NextResponse.json({ sections: context.sections, flockChosenForYou: !batchId && Boolean(context.batchId) }, { headers });
}
