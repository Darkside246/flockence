export async function verifySignupCaptcha(token: unknown, hostname: string): Promise<"verified" | "rejected" | "unavailable"> {
  const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
  if (!secret || !process.env.RECAPTCHA_SITE_KEY?.trim()) return "unavailable";
  if (typeof token !== "string" || !token || token.length > 4096) return "rejected";

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) return "unavailable";
    const result = await response.json();
    if (typeof result?.success !== "boolean") return "unavailable";
    const errors = result["error-codes"];
    if (Array.isArray(errors) && errors.some(code => code === "invalid-input-secret" || code === "missing-input-secret")) {
      return "unavailable";
    }
    return result.success && result.hostname === hostname ? "verified" : "rejected";
  } catch {
    return "unavailable";
  }
}

/** Null preserves standalone installs that have no CAPTCHA configuration. */
export function accountCaptchaSiteKey(): string | null {
  const siteKey = process.env.RECAPTCHA_SITE_KEY?.trim() ?? "";
  const configured = Boolean(siteKey || process.env.RECAPTCHA_SECRET_KEY?.trim());
  return configured || process.env.FLOCKENCE_AUTH_CAPTCHA === "on" ? siteKey : null;
}
