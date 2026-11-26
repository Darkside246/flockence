import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, sessionCookieFromRequest } from "@/lib/auth";


export async function POST(request: Request) {
  const token = sessionCookieFromRequest(request);
  if (token) await destroySession(token);
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
