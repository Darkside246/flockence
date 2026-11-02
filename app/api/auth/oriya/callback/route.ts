import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORIYA_SESSION_SECONDS, createSession, setSessionCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { runAsFarm } from "@/lib/farm-scope";
import { signOriyaBody } from "@/lib/oriya-link.mjs";
import { openSignIn, oriyaUserEmail, readIdentity, sameState } from "@/lib/oriya-account.mjs";
import { oriyaBaseUrl, platformSecret } from "@/lib/oriya-farm-link";

export const runtime = "nodejs";

const SIGN_IN_COOKIE = "flockence_oriya_sso";
const CODE = /^[A-Za-z0-9_-]{43}$/;

function page(message: string, status = 400) {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flockence</title>` +
    `<body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1d2b1f"><h1 style="font-size:1.25rem">Could not sign you in</h1>` +
    `<p>${message}</p><p><a href="/api/auth/oriya/start">Try again</a></p></body></html>`;
  const response = new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", `${SIGN_IN_COOKIE}=; Path=/api/auth/oriya; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

/**
 * "Sign in with Oriya", step 2: the state must match this browser's own sign-in cookie; the code is exchanged once by
 * this server (signed with the platform secret, with the PKCE verifier). The person is added to, or updated in, their
 * own farm only, with the role Oriya gives them; no password is kept here.
 */
export async function GET(request: Request) {
  const base = oriyaBaseUrl();
  const secret = platformSecret();
  const auth = process.env.AUTH_SECRET ?? "";
  if (!base || !secret || auth.length < 32) return page("Sign in with Oriya is not set up on this server.", 503);
  const ip = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "local";
  if (!(await checkRateLimit("oriya-sso:callback:" + ip, 30, 10 * 60_000)).allowed) return page("Too many sign-in attempts. Please wait a few minutes.", 429);

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookie = (request.headers.get("cookie") ?? "").split(";").map((p) => p.trim()).find((p) => p.startsWith(`${SIGN_IN_COOKIE}=`))?.slice(SIGN_IN_COOKIE.length + 1);
  const attempt = openSignIn(auth, cookie ? decodeURIComponent(cookie) : null);
  if (!attempt || !sameState(attempt.state, state) || !CODE.test(code)) return page("This sign-in link has expired or was not started here. Please open Flockence from Oriya again.");

  const body = JSON.stringify({ code, codeVerifier: attempt.verifier });
  const timestamp = Math.floor(Date.now() / 1000);
  let reply: Response;
  try {
    reply = await fetch(new URL("/api/public/flockence/sso/token", base), {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", "X-Oriya-Timestamp": String(timestamp), "X-Oriya-Signature": signOriyaBody(secret, timestamp, body) },
      body,
    });
  } catch {
    return page("Oriya did not answer. Please try again in a moment.", 502);
  }
  if (reply.status === 403) return page("You are no longer a member of this farm in Oriya.", 403);
  if (reply.status === 409) return page("Your farm is not set up in Flockence yet. In Oriya, open Farm > Poultry and choose Poultry.", 409);
  if (!reply.ok) return page("Oriya did not accept this sign-in. Please open Flockence from Oriya again.");
  const identity = readIdentity(await reply.json().catch(() => null));
  if (!identity) return page("Oriya sent back something unexpected. Please try again.", 502);

  const session = await runAsFarm(identity.farmId, async () => {
    const farm = await prisma.farm.findUnique({ where: { id: identity.farmId }, select: { id: true } });
    if (!farm) return null;
    const email = oriyaUserEmail(identity.oriyaUserId, identity.farmId);
    const user = await prisma.user.upsert({
      where: { email },
      create: { farmId: identity.farmId, email, name: identity.name, role: identity.role },
      update: { name: identity.name, role: identity.role },
      select: { id: true },
    });
    return createSession(user.id, ORIYA_SESSION_SECONDS);
  });
  if (!session) return page("Your farm is not set up in Flockence yet. In Oriya, open Farm > Poultry and choose Poultry.", 409);

  const response = NextResponse.redirect(new URL("/", process.env.APP_URL || request.url).toString(), 302);
  response.headers.append("Set-Cookie", setSessionCookie(session.token, ORIYA_SESSION_SECONDS));
  response.headers.append("Set-Cookie", `${SIGN_IN_COOKIE}=; Path=/api/auth/oriya; HttpOnly; SameSite=Lax; Max-Age=0`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
