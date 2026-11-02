import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPasswordHash, createSession, setSessionCookie, normalizeEmail, verifyPassword } from "@/lib/auth";
import { ensureFarm } from "@/lib/operations";
import { checkRateLimit } from "@/lib/rate-limit";
import { runAsFarm, runUnscoped } from "@/lib/farm-scope";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (password.length > 128 || email.length > 254) {
      return NextResponse.json({ error: "Email or password is too long." }, { status: 400 });
    }

    const ip = request.headers.get("cf-connecting-ip")?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "";
    const [emailLimit, ipLimit] = await Promise.all([
      checkRateLimit("login:email:" + email, 8, 15 * 60 * 1000),
      ip ? checkRateLimit("login:ip:" + ip, 40, 15 * 60 * 1000) : Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please try again later.", retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }

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
