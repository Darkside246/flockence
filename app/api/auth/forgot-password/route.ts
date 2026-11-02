import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureFarm } from "@/lib/operations";
import { createPasswordReset, normalizeEmail } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { runAsFarm, runUnscoped } from "@/lib/farm-scope";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const clientIp = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "";
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
    const user = await runUnscoped(() => prisma.user.findUnique({ where: { email }, select: { id: true, farmId: true, email: true } }));
    if (user) {
      const reset = await runAsFarm(user.farmId, async () => { await ensureFarm(); return createPasswordReset(user.id); });
      const base = process.env.APP_URL || request.headers.get("origin") || "http://localhost:3000";
      const resetUrl = `${base.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(reset.token)}`;
      await sendPasswordResetEmail(user.email, resetUrl).catch(() => undefined);
      if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
        return NextResponse.json({ message: "If the account exists, a reset link has been prepared.", developmentResetUrl: resetUrl });
      }
    }
    return NextResponse.json({ message: "If an account exists for that email, a password reset link will be sent shortly." });
  } catch {
    return NextResponse.json({ message: "If an account exists for that email, a password reset link will be sent shortly." });
  }
}
