async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });
  return response.ok;
}


export function sendPasswordResetEmail(to: string, resetUrl: string) {
  return sendEmail(to, "Flockence password reset",
    `<p>We received a request to reset your Flockence password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`);
}

export function sendSignupWelcomeEmail(to: string) {
  return sendEmail(to, "Welcome to Flockence",
    '<p>Your Flockence account is ready.</p><p><a href="https://flockence.com/login">Sign in to Flockence</a></p><p>If you didn’t create this account, you can ignore this email.</p>');
}

export function sendFreeSignupVerificationEmail(to: string, url: string) {
  const safeUrl = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return sendEmail(to, "Verify your email for Flockence",
    `<p>Confirm this email address to create your Free Flockence farm.</p><p><a href="${safeUrl}">Verify email and finish signup</a></p><p>The link expires in 30 minutes and works once. If you didn’t request it, you can ignore this email.</p>`);
}
