import { applyEmailTemplate, type EmailCategoryId, type EmailMessage } from "./email-templates.mjs";

/**
 * Outgoing email through Resend. RESEND_API_KEY and RESEND_FROM are server settings for the developer/administrator
 * (the private service environment), never stored in the app. Without both, nothing is sent and the caller gets false.
 */
export async function sendEmail(to: string, message: { subject: string; text?: string; html?: string }, key?: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(6000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify({ from, to: [to], ...message }),
  });
  return response.ok;
}

/**
 * The owner's template for this kind of email (Settings > Email), applied over the message below. Loaded lazily and
 * best-effort: without a database (unit tests) or if loading fails, the message goes out with its default wording.
 * The link, expiry and report content are always part of the message, so a template cannot break them.
 */
async function templated<T extends EmailMessage>(category: EmailCategoryId, message: T, farmId?: string | null): Promise<T> {
  try {
    const { loadEmailTemplate } = await import("@/lib/email-template-store");
    const { template, farm } = await loadEmailTemplate(category, farmId);
    return applyEmailTemplate(category, message, template, { farm });
  } catch {
    return message;
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  return sendEmail(to, await templated("password_reset", {
    subject: "Flockence password reset",
    html: `<p>We received a request to reset your Flockence password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
  }));
}

export async function sendWelcomeEmail(to: string, userId: string) {
  if (process.env.FLOCKENCE_WELCOME_EMAIL !== "on") return false;
  let login: URL;
  try {
    const base = new URL(process.env.APP_URL ?? "");
    if (base.protocol !== "https:" || base.username || base.password) return false;
    login = new URL("/login", base);
  } catch {
    return false;
  }
  return sendEmail(to, await templated("welcome", {
    subject: "Welcome to Flockence",
    text: `Your Flockence account is ready. Sign in to open your farm workspace.\n\n${login.href}`,
  }), "flockence-welcome-" + userId);
}

export async function sendFreeSignupVerificationEmail(to: string, url: string) {
  return sendEmail(to, await templated("signup_verification", {
    subject: "Verify your email for Flockence",
    text: `Confirm this email address to create your Free Flockence farm. This single-use link expires after 30 minutes.\n\n${url}`,
  }));
}

export async function sendTeamInvitationEmail(to: string, url: string, farmName: string, expiresAt: Date, inviteId: string, farmId?: string) {
  return sendEmail(to, await templated("team_invitation", {
    subject: "Join your team on Flockence",
    text: `You were invited to join ${farmName} on Flockence. Open this single-use link to create your account. It expires on ${expiresAt.toISOString().slice(0, 10)} (UTC).\n\n${url}`,
  }, farmId), "flockence-team-invite-" + inviteId);
}

/** The daily Farm Vision report (lib/vision-daily-report.ts). The key makes a resend the same day a no-op. */
export async function sendVisionReportEmail(to: string, message: { subject: string; text: string; html: string }, key: string, farmId?: string) {
  return sendEmail(to, await templated("vision_daily_report", message, farmId), key);
}

/** Farm alerts from the farm's own records (lib/farm-alerts.ts). */
export async function sendFarmAlertEmail(to: string, message: { subject: string; text: string; html: string }, key: string, farmId?: string) {
  return sendEmail(to, await templated("farm_alert", message, farmId), key);
}

/** A Farm Vision alert (lib/vision-alerts.ts). */
export async function sendVisionAlertEmail(to: string, message: { subject: string; text: string; html: string }, key: string, farmId?: string) {
  return sendEmail(to, await templated("vision_alert", message, farmId), key);
}
