import { NextResponse } from "next/server";
import { authError, requireCurrentUser } from "@/lib/current-user";
import { getFarmWeather } from "@/lib/weather";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    return NextResponse.json(await getFarmWeather());
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ configured: false, reason: error instanceof Error ? error.message : "Weather is temporarily unavailable." }, { status: 502 });
  }
}
