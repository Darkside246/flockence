import { accountCaptchaResponse, accountClientIp, accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm } from "@/lib/operations";
import { createPasswordReset, normalizeEmail } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
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
    const clientIp = accountClientIp(request);
    const [emailLimit, ipLimit] = await Promise.all([
      checkRateLimit("password-reset:email:" + email, 3, 60 * 60 * 1000),
      clientIp ? checkRateLimit("password-reset:ip:" + clientIp, 8, 60 * 60 * 1000) : Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      return NextResponse.json(
        { message: "If an account exists for that email, a password reset link will be sent shortly.", retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }
    if (!email || email.length > 254) {
      return NextResponse.json({ message: "If an account exists for that email, a password reset link will be sent shortly." });
    }
    const captchaResponse = await accountCaptchaResponse(body.captchaToken);
    if (captchaResponse) return captchaResponse;

    const configuredUrl = process.env.APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
    const base = new URL(configuredUrl);
    if (base.username || base.password || !["http:", "https:"].includes(base.protocol)
      || (process.env.NODE_ENV === "production" && base.protocol !== "https:")) {
      throw new Error("Invalid APP_URL for password resets.");
    }
    const user = await runUnscoped(() => prisma.user.findUnique({ where: { email }, select: { id: true, farmId: true, email: true } }));
    if (user) {
      const reset = await runAsFarm(user.farmId, async () => { await ensureFarm(); return createPasswordReset(user.id); });
      const resetUrl = new URL("/reset-password", base);
      resetUrl.searchParams.set("token", reset.token);
      await sendPasswordResetEmail(user.email, resetUrl.toString()).catch(() => undefined);
      if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
        return NextResponse.json({ message: "If the account exists, a reset link has been prepared.", developmentResetUrl: resetUrl.toString() });
      }
    }
    return NextResponse.json({ message: "If an account exists for that email, a password reset link will be sent shortly." });
  } catch {
    return NextResponse.json({ message: "If an account exists for that email, a password reset link will be sent shortly." });
  }
}
