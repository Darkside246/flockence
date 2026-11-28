import { accountCaptchaResponse, accountClientIp, accountFormOriginResponse, accountRateLimitResponse, readAccountForm } from "@/lib/account-form-security";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPasswordHash, createSession, setSessionCookie, normalizeEmail, verifyPassword, lockPasswordAccount } from "@/lib/auth";
import { ensureFarm } from "@/lib/operations";
import { runAsFarm, runUnscoped } from "@/lib/farm-scope";
import { checkSecondFactor, twoFactorEnabled } from "@/lib/two-factor";

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

    // Two-factor sign-in (Account page): after a correct password, a code from the authenticator app or a recovery code.
    // The email rate limit above also limits code guesses.
    if (await runAsFarm(user.farmId, () => twoFactorEnabled(user.id))) {
      const code = typeof body.code === "string" ? body.code.slice(0, 32) : "";
      if (!code) return NextResponse.json({ twoFactorRequired: true, error: "Enter the 6-digit code from your authenticator app, or one of your recovery codes." }, { status: 401 });
      if (!(await runAsFarm(user.farmId, () => checkSecondFactor(user.id, code)))) {
        return NextResponse.json({ twoFactorRequired: true, error: "That code is not right or has already been used. Check the time on your phone and try the newest code." }, { status: 401 });
      }
    }

    const session = await runAsFarm(user.farmId, async () => {
      await ensureFarm();
      return prisma.$transaction(async tx => {
        await lockPasswordAccount(tx, user.id);
        if (await getPasswordHash(user.id, tx) !== stored) return null;
        return createSession(user.id, undefined, tx);
      });
    });
    if (!session) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
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
