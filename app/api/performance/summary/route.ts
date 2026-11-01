import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { getPoultryPerformance } from "@/lib/poultry-performance";

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  try {
    const value = await getPoultryPerformance(session.user!.farmId);
    return NextResponse.json(value, {
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to calculate poultry performance." },
      { status: 500 },
    );
  }
}
