import { after, NextResponse } from "next/server";
import { normalizeEmail, setSessionCookie, validatePassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { completeVerifiedFreeSignup, discardFreeEmailProof, freeSignupTokenPattern, issueFreeEmailProof } from "@/lib/free-email-proof";
import { freeSignupEnabled } from "@/lib/free-signup-enabled";
import { accountClientIp, accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { verifySignupCaptcha } from "@/lib/signup-captcha";
import { sendFreeSignupVerificationEmail, sendWelcomeEmail } from "@/lib/mail";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const reply = (message: string, status: number) =>
  NextResponse.json(status >= 400 ? { error: message } : { message }, { status, headers });

function signupUrl(token: string) {
  const origin = new URL(process.env.APP_URL ?? "");
  if (origin.username || origin.password || !["https:", "http:"].includes(origin.protocol)
    || (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) {
    throw new Error("INVALID_SIGNUP_ORIGIN");
  }
  const url = new URL("/signup/free", origin);
  url.hash = "token=" + token;
  return url.toString();
}

export async function POST(request: Request) {
  if (!freeSignupEnabled()) return reply("Public signup is unavailable.", 404);
  if (process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "true") {
    return reply("Signup is temporarily unavailable.", 503);
  }
  const originResponse = accountFormOriginResponse(request);
  if (originResponse) return originResponse;
  const data = await readAccountForm(request);
  if (!data) return reply("Invalid signup form.", 400);
  const ip = accountClientIp(request) || "unknown";
  try {
    if (data?.action === "send") {
      const email = typeof data.email === "string" ? normalizeEmail(data.email) : "";
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return reply("Enter a valid email address.", 400);
      if (!(await checkRateLimit("free-signup-send-ip:" + ip, 10, 3600000)).allowed) {
        return reply("Too many requests. Please try again later.", 429);
      }
      const hostname = new URL(signupUrl("")).hostname;
      const captcha = await verifySignupCaptcha(data.captchaToken, hostname, "free_signup");
      if (captcha === "unavailable") return reply("Signup security check is temporarily unavailable.", 503);
      if (captcha === "rejected") return reply("Could not verify the security check. Please try again.", 400);
      if (!(await checkRateLimit("free-signup-email:" + email, 3, 3600000)).allowed) {
        return reply("Too many requests. Please try again later.", 429);
      }
      if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return reply("Signup email is temporarily unavailable.", 503);
      const token = await issueFreeEmailProof(email);
      try {
        if (!(await sendFreeSignupVerificationEmail(email, signupUrl(token)))) throw new Error("EMAIL_FAILED");
      } catch {
        await discardFreeEmailProof(token).catch(() => undefined);
        return reply("Could not send the verification email. Please try again later.", 503);
      }
      return reply("Check your inbox for a verification link.", 202);
    }

    if (data?.action !== "finish" || typeof data.token !== "string" || !freeSignupTokenPattern.test(data.token)) {
      return reply("Open a current verification link from your email.", 400);
    }
    if (!(await checkRateLimit("free-signup-finish-ip:" + ip, 20, 3600000)).allowed) {
      return reply("Too many requests. Please try again later.", 429);
    }
    const ownerName = typeof data.ownerName === "string" ? data.ownerName.trim() : "";
    const farmName = typeof data.farmName === "string" ? data.farmName.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    const strength = validatePassword(password);
    if (ownerName.length < 2 || ownerName.length > 120 || farmName.length > 120 || (farmName && farmName.length < 2) || password.length > 128) {
      return reply("Check the account and farm details.", 400);
    }
    if (!strength.valid) return reply(strength.errors.join(" "), 400);
    const { owner, session, verifiedEmail } = await completeVerifiedFreeSignup(data.token, { ownerName, farmName: farmName || "My farm", password });
    const response = NextResponse.json({ created: true }, { status: 201, headers });
    response.headers.set("Set-Cookie", setSessionCookie(session.token));
    if (process.env.FLOCKENCE_WELCOME_EMAIL === "on") after(async () => {
      try {
        if (!(await sendWelcomeEmail(verifiedEmail, owner.id))) console.warn("[auth/free-signup] welcome email unavailable");
      } catch {
        console.warn("[auth/free-signup] welcome email unavailable");
      }
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_SIGNUP_PROOF") return reply("This link expired or has already been used. Request a new link.", 400);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return reply("An account already exists for this address. Sign in or reset your password.", 409);
    }
    console.error("[auth/free-signup] request failed");
    return reply("Could not complete signup. Please try again.", 503);
  }
}
