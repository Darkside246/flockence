import { accountCaptchaResponse, accountClientIp, accountFormOriginResponse, accountRateLimitResponse, readAccountForm } from "@/lib/account-form-security";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPasswordHash, createSession, setSessionCookie, normalizeEmail, verifyPassword } from "@/lib/auth";
import { ensureFarm } from "@/lib/operations";
import { runAsFarm, runUnscoped } from "@/lib/farm-scope";

export async function POST(request: Request) {
  // Oriya-only server: accounts come only from Oriya ("Sign in with Oriya"); no local passwords.
  if (process.env.FLOCKENCE_ORIYA_ONLY === "on") return NextResponse.json({ error: "Sign in with Oriya." }, { status: 404 });
  const originResponse = accountFormOriginResponse(request);
  if (originResponse) return originResponse;
  try {
    const body = await readAccountForm(request);
    if (!body) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (password.length > 128 || email.length > 254) {
      return NextResponse.json({ error: "Email or password is too long." }, { status: 400 });
    }

    const message = "Too many sign-in attempts. Please try again later.";
    const ip = accountClientIp(request) || "unknown";
    const ipResponse = await accountRateLimitResponse("login:ip:" + ip, 40, 15 * 60_000, message);
    if (ipResponse) return ipResponse;

    const captchaResponse = await accountCaptchaResponse(body.captchaToken, "login");
    if (captchaResponse) return captchaResponse;

    const emailResponse = await accountRateLimitResponse("login:email:" + email, 8, 15 * 60_000, message);
    if (emailResponse) return emailResponse;

    // Which farm the email belongs to (many farms on one server); everything after runs inside that farm only.
    const user = await runUnscoped(() => prisma.user.findUnique({
      where: { email },
      select: { id: true, farmId: true, name: true, email: true }
    }));
    const stored = user ? await runAsFarm(user.farmId, () => getPasswordHash(user.id)) : null;

    if (!user || !stored || !(await verifyPassword(password, stored))) {
      // People who joined from Oriya have no password here: they open Flockence from Oriya.
      return NextResponse.json({ error: "Email or password is incorrect. If you joined from Oriya, open Flockence from Oriya instead." }, { status: 401 });
    }

    const session = await runAsFarm(user.farmId, async () => { await ensureFarm(); return createSession(user.id); });
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
    response.headers.set("Set-Cookie", setSessionCookie(session.token));
    return response;
  } catch (error) {
    console.error("[auth/login] login failed", error);
    const message = error instanceof Error ? error.message : "Unable to sign in.";
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? message : "Unable to sign in." },
      { status: 500 }
    );
  }
}
