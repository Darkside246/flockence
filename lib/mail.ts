async function sendEmail(to: string, message: { subject: string; text?: string; html?: string }, key?: string) {
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

export function sendPasswordResetEmail(to: string, resetUrl: string) {
  return sendEmail(to, {
    subject: "Flockence password reset",
    html: `<p>We received a request to reset your Flockence password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
  });
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
  return sendEmail(to, {
    subject: "Welcome to Flockence",
    text: `Your Flockence account is ready. Sign in to open your farm workspace.\n\n${login.href}`,
  }, "flockence-welcome-" + userId);
}

export function sendFreeSignupVerificationEmail(to: string, url: string) {
  return sendEmail(to, {
    subject: "Verify your email for Flockence",
    text: `Confirm this email address to create your Free Flockence farm. This single-use link expires after 30 minutes.\n\n${url}`,
  });
}

export function sendTeamInvitationEmail(to: string, url: string, farmName: string, expiresAt: Date, inviteId: string) {
  return sendEmail(to, {
    subject: "Join your team on Flockence",
    text: `You were invited to join ${farmName} on Flockence. Open this single-use link to create your account. It expires on ${expiresAt.toISOString().slice(0, 10)} (UTC).\n\n${url}`,
  }, "flockence-team-invite-" + inviteId);
}

/** The daily Farm Vision report (lib/vision-daily-report.ts). The key makes a resend the same day a no-op. */
export function sendVisionReportEmail(to: string, message: { subject: string; text: string; html: string }, key: string) {
  return sendEmail(to, message, key);
}

/** A Farm Vision alert (lib/vision-alerts.ts). */
export function sendVisionAlertEmail(to: string, message: { subject: string; text: string; html: string }, key: string) {
  return sendEmail(to, message, key);
}
