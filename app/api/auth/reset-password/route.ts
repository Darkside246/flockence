import { accountClientIp, accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { resetAccountPassword, validatePassword } from "@/lib/auth";

export async function POST(request: Request) {
  // Oriya-only server: accounts come only from Oriya ("Sign in with Oriya"); no local passwords.
  if (process.env.FLOCKENCE_ORIYA_ONLY === "on") return NextResponse.json({ error: "Sign in with Oriya." }, { status: 404 });
  const originResponse = accountFormOriginResponse(request);
  if (originResponse) return originResponse;
  try {
    const body = await readAccountForm(request);
    if (!body) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    const clientIp = accountClientIp(request);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [tokenLimit, ipLimit] = await Promise.all([
      checkRateLimit("password-reset-complete:token:" + tokenHash, 5, 60 * 60 * 1000),
      clientIp ? checkRateLimit("password-reset-complete:ip:" + clientIp, 10, 60 * 60 * 1000) : Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    ]);
    if (!tokenLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(tokenLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      return NextResponse.json({ error: "Too many password reset attempts. Request a new reset link later.", retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }
    if (!token || token.length > 256) {
      return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    }
    const check = validatePassword(password);
    if (!check.valid) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });
    if (password.length > 128) return NextResponse.json({ error: "Password is too long." }, { status: 400 });
    const done = await resetAccountPassword(token, password);
    if (!done) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to reset the password." }, { status: 500 });
  }
}
