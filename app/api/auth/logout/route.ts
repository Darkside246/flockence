import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, SESSION_COOKIE } from "@/lib/auth";

function tokenFromCookie(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(`${SESSION_COOKIE}=`.length);
}

export async function POST(request: Request) {
  const token = tokenFromCookie(request);
  if (token) await destroySession(decodeURIComponent(token));
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
