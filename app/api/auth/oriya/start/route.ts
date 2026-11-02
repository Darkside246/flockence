import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { newSignIn, sealSignIn } from "@/lib/oriya-account.mjs";
import { oriyaBaseUrl, platformSecret } from "@/lib/oriya-farm-link";

export const runtime = "nodejs";

const SIGN_IN_COOKIE = "flockence_oriya_sso";

/**
 * "Sign in with Oriya", step 1 (2026-11-02): a fresh state and PKCE pair, kept in a short signed cookie on this browser
 * only (10 minutes, HttpOnly, only sent back to the callback), then off to Oriya, which asks the person to sign in if
 * needed and hands back a one-use code.
 */
export async function GET(request: Request) {
  const base = oriyaBaseUrl();
  const auth = process.env.AUTH_SECRET ?? "";
  if (!base || !platformSecret() || auth.length < 32) return NextResponse.json({ error: "Sign in with Oriya is not set up on this server." }, { status: 503 });
  const ip = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "local";
  const limit = await checkRateLimit("oriya-sso:start:" + ip, 30, 10 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Please wait a few minutes." }, { status: 429 });
  const attempt = newSignIn();
  const target = new URL("/flockence/open", base);
  target.searchParams.set("state", attempt.state);
  target.searchParams.set("code_challenge", attempt.challenge);
  target.searchParams.set("code_challenge_method", "S256");
  const response = NextResponse.redirect(target.toString(), 302);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${SIGN_IN_COOKIE}=${sealSignIn(auth, attempt)}; Path=/api/auth/oriya; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
