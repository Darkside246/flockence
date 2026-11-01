import { NextResponse } from "next/server";
import { currentUserOrResponse } from "@/lib/current-user";
import { dashboardData } from "@/lib/operations";
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  try { return NextResponse.json(await dashboardData()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Database is not configured" }, { status: 503 }); }
}
