import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { penLayout } from "@/lib/pen-layout";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** Pen size and layout advice for one pen (lib/pen-layout.ts). Every plan; reads only. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const penId = new URL(request.url).searchParams.get("penId");
  if (!penId || !/^[A-Za-z0-9_-]{1,64}$/.test(penId)) return NextResponse.json({ error: "Choose a pen." }, { status: 400, headers });
  await ensureFarm();
  const advice = await penLayout(penId);
  if (!advice) return NextResponse.json({ error: "Pen not found." }, { status: 404, headers });
  return NextResponse.json({ advice }, { headers });
}
