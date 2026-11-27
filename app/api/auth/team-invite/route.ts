import { NextResponse } from "next/server";
import { accountClientIp, accountFormOriginResponse, accountRateLimitResponse, readAccountForm } from "@/lib/account-form-security";
import { setSessionCookie, validatePassword } from "@/lib/auth";
import { inspectEmailTeamInvite, redeemEmailTeamInvite } from "@/lib/email-team-invites";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
const invalid = () => fail("This invitation is invalid or expired. Ask your farm owner for a new link.", 404);

export async function POST(request: Request) {
  if (process.env.FLOCKENCE_ORIYA_ONLY === "on") return invalid();
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const data = await readAccountForm(request);
  if (!data || typeof data.token !== "string" || data.token.length > 108
    || (data.action !== "inspect" && data.action !== "join")) return invalid();
  try {
    const ip = accountClientIp(request) || "unknown";
    const limit = await accountRateLimitResponse("team-invite:" + data.action + ":" + ip, 20, 15 * 60_000, "Too many attempts. Try again shortly.");
    if (limit) return limit;
    if (data.action === "inspect") {
      const invite = await inspectEmailTeamInvite(data.token);
      return invite ? NextResponse.json(invite, { headers }) : invalid();
    }
    if (process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "true") {
      return fail("Team signup is temporarily unavailable.", 503);
    }
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    if (name.length < 2 || name.length > 120) return fail("Enter a name of 2 to 120 characters.", 400);
    const result = validatePassword(password);
    if (!result.valid || password.length > 128) return fail(result.errors.join(" ") || "Password is too long.", 400);
    const session = await redeemEmailTeamInvite(data.token, name, password);
    if (!session) return invalid();
    const response = NextResponse.json({ joined: true }, { status: 201, headers });
    response.headers.set("Set-Cookie", setSessionCookie(session.token));
    return response;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return fail("This email already has a Flockence account. Sign in or ask the farm owner for help.", 409);
    }
    return fail("Could not accept the invitation. Try again shortly.", 503);
  }
}
