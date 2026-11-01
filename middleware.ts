import { NextRequest, NextResponse } from "next/server";

export async function middleware(_request: NextRequest) {
  // Cheapest possible refusal for the camera and Oriya routes (security review 2026-11-01): no session cookie, or no
  // Oriya signature, is turned away here before any page code, database or camera service is touched. The full checks
  // still run in the routes themselves.
  const path = _request.nextUrl.pathname;
  if (path.startsWith("/api/cameras/") && !_request.cookies.has("chicken_op_session")) {
    return new NextResponse(JSON.stringify({ error: "Sign-in is required." }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  }
  if (path === "/api/integrations/oriya/camera-frames" && !_request.headers.get("x-oriya-signature")?.startsWith("v1=")) {
    return new NextResponse(JSON.stringify({ error: "BAD_SIGNATURE" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  }
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  response.headers.set("Cache-Control", "no-store");
  // Camera pictures and video: never stored anywhere, and no address sent on to any other site.
  if (_request.nextUrl.pathname.startsWith("/api/cameras/") || _request.nextUrl.pathname.startsWith("/api/integrations/oriya/")) {
    response.headers.set("Cache-Control", "no-store, private");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  if (process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = { matcher: ["/(.*)"] };
