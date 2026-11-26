import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { accountCaptchaSiteKey, verifySignupCaptcha } from "@/lib/signup-captcha";

export function accountClientIp(request: Request) {
  const ip = request.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(ip) ? ip : "";
}

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function accountFormOriginResponse(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return refuse("Submit this form from Flockence.", 415);
  }
  if ((process.env.APP_URL || accountCaptchaSiteKey() !== null) && !isTrustedAppOrigin(request)) {
    return refuse("Submit this form from the Flockence website.", 403);
  }
  return null;
}

export async function accountCaptchaResponse(token: unknown) {
  if (accountCaptchaSiteKey() === null) return null;
  let hostname: string;
  try {
    hostname = new URL(process.env.APP_URL ?? "").hostname;
  } catch {
    return refuse("Account security check is temporarily unavailable.", 503);
  }
  const status = await verifySignupCaptcha(token, hostname);
  if (status === "unavailable") return refuse("Account security check is temporarily unavailable.", 503);
  if (status === "rejected") return refuse("Complete the security check and try again.", 400);
  return null;
}

// Account forms carry short strings. Avoid buffering uploads under the larger camera proxy limit.
export async function readAccountForm(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    const limit = 16 * 1024;
    let length = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function accountRateLimitResponse(key: string, limit: number, windowMs: number, error: string) {
  const result = await checkRateLimit(key, limit, windowMs);
  if (result.allowed) return null;
  return NextResponse.json({ error, retryAfterSeconds: result.retryAfterSeconds }, {
    status: 429,
    headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" },
  });
}
