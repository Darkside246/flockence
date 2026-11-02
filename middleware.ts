import { NextRequest, NextResponse } from "next/server";

export async function middleware(_request: NextRequest) {
  // Cheapest possible refusal for the camera and Oriya routes (security review 2026-11-01): no session cookie, or no
  // Oriya signature, is turned away here before any page code, database or camera service is touched. The full checks
  // still run in the routes themselves.
  const path = _request.nextUrl.pathname;
  // Oriya-only server (owner, 2026-11-02: "no one should be able to type in flockence.oriya.si and see anything"):
  // without a session cookie, pages go straight to "Sign in with Oriya" and the API answers 401; only the sign-in
  // hand-off and the signed Oriya integration routes are reachable. Every route still checks the session fully.
  if (process.env.FLOCKENCE_ORIYA_ONLY === "on" && !_request.cookies.has("chicken_op_session")
      && !path.startsWith("/api/auth/oriya/") && !path.startsWith("/api/integrations/")) {
    if (path.startsWith("/api/")) return new NextResponse(JSON.stringify({ error: "Sign-in is required." }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" } });
    const start = new NextResponse(null, { status: 302, headers: { Location: new URL("/api/auth/oriya/start", _request.url).toString(), "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
    return start;
  }
  if (path.startsWith("/api/cameras/") && !_request.cookies.has("chicken_op_session")) {
    return new NextResponse(JSON.stringify({ error: "Sign-in is required." }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  }
  if ((path === "/api/integrations/oriya/camera-frames" || path === "/api/integrations/oriya/provision") && !_request.headers.get("x-oriya-signature")?.startsWith("v1=")) {
    return new NextResponse(JSON.stringify({ error: "BAD_SIGNATURE" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  }
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
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
