import { NextResponse } from "next/server";
import { oriyaBaseUrl, platformSecret } from "@/lib/oriya-farm-link";

export const runtime = "nodejs";

/** Whether "Sign in with Oriya" can work on this server. Says only yes or no; never which setting is missing. */
export async function GET() {
  const available = Boolean(oriyaBaseUrl() && platformSecret() && (process.env.AUTH_SECRET ?? "").length >= 32);
  return NextResponse.json({ available }, { headers: { "Cache-Control": "no-store" } });
}
