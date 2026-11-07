import { accountClientIp } from "@/lib/account-form-security";
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
  if (!base || !platformSecret() || auth.length < 32) {
    // a readable page, not raw JSON: the person clicked a button
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flockence</title>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1d2b1f"><h1 style="font-size:1.25rem">Sign in with Oriya is not available here</h1>` +
      `<p>This Flockence has not been linked to Oriya yet. Sign in with your email and password instead, or ask the farm owner to link it.</p><p><a href="/login">Back to sign in</a></p></body></html>`;
    return new NextResponse(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const ip = accountClientIp(request) || "unknown";
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
