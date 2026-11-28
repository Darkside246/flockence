/**
 * Editable email templates (owner, 28 Nov 2026: "the template should be able to set in the settings based on the
 * categories we already have"). One template per kind of email Flockence already sends. The owner may change the
 * subject, add an opening paragraph and a closing line; the part that makes the email work (the link, its expiry, the
 * report itself) is always included as written in lib/mail.ts, so a template can never break a sign-in or reset link.
 * With nothing saved, every email is exactly what it was before templates existed.
 *
 * Pure functions only: no database, no network. lib/email-template-store.ts loads and saves; lib/mail.ts sends.
 */

/** Account emails go out before or outside a farm, so they use the home farm's templates (DEFAULT_FARM_ID). */
export const emailCategories = [
  { id: "signup_verification", group: "account", label: "Sign-up verification", subject: "Verify your email for Flockence",
    hint: "Sent to someone starting a Free farm. The single-use link and its 30-minute expiry are always included." },
  { id: "welcome", group: "account", label: "Welcome", subject: "Welcome to Flockence",
    hint: "Sent after a new account is created, when welcome emails are switched on. The sign-in link is always included." },
  { id: "password_reset", group: "account", label: "Password reset", subject: "Flockence password reset",
    hint: "Sent when someone asks to reset a password. The reset link and its 30-minute expiry are always included." },
  { id: "team_invitation", group: "farm", label: "Team invitation", subject: "Join your team on Flockence",
    hint: "Sent when you invite a supervisor, farm hand or read-only member. The invitation link and its expiry are always included." },
  { id: "vision_daily_report", group: "farm", label: "Daily Farm Vision report", subject: "{subject}",
    hint: "The once-a-day Farm Vision email. The report itself is always included. {subject} is the report's own subject line." },
  { id: "vision_alert", group: "farm", label: "Farm Vision alert", subject: "{subject}",
    hint: "Sent straight away for urgent or attention-soon findings. The finding itself is always included. {subject} is the alert's own subject line." },
];

export const emailCategoryIds = emailCategories.map((c) => c.id);
export const EMAIL_TEMPLATE_LIMITS = { subject: 150, intro: 1000, footer: 500 };
export const emailTemplateFields = ["subject", "intro", "footer"];

export function isEmailCategory(id) {
  return emailCategoryIds.includes(id);
}

export function emailCategory(id) {
  return emailCategories.find((c) => c.id === id) ?? null;
}

/** Setting key for one field of one category, e.g. "email_template.welcome.subject". */
export function emailTemplateKey(category, field) {
  return `email_template.${category}.${field}`;
}

/** Remove control characters (keeping new lines in the body fields), trim, and cap the length. */
export function cleanTemplateField(field, value) {
  if (typeof value !== "string") return "";
  const singleLine = field === "subject";
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(singleLine ? /[\u0000-\u001f\u007f]+/g : /[\u0000-\u0009\u000b-\u001f\u007f]+/g, singleLine ? " " : "");
  return stripped.replace(/\r\n?/g, "\n").trim().slice(0, EMAIL_TEMPLATE_LIMITS[field] ?? 0);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fill(text, values) {
  return text.replace(/\{(farm|subject)\}/g, (_, name) => values[name] ?? "");
}

function paragraphsHtml(text) {
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * Apply a saved template to a message lib/mail.ts built. `template` holds the saved fields (missing or empty = default).
 * `values.farm` fills {farm}; {subject} is always the message's own subject. Returns a new message.
 */
export function applyEmailTemplate(category, message, template, values = {}) {
  const fields = template ?? {};
  const vars = { farm: values.farm ?? "", subject: message.subject };
  const customSubject = cleanTemplateField("subject", fields.subject ?? "");
  const subject = customSubject ? cleanTemplateField("subject", fill(customSubject, vars)) || message.subject : message.subject;
  const intro = fill(cleanTemplateField("intro", fields.intro ?? ""), vars).trim();
  const footer = fill(cleanTemplateField("footer", fields.footer ?? ""), vars).trim();
  const out = { ...message, subject };
  if (message.text !== undefined) out.text = [intro, message.text, footer].filter(Boolean).join("\n\n");
  if (message.html !== undefined) out.html = (intro ? paragraphsHtml(intro) : "") + message.html + (footer ? paragraphsHtml(footer) : "");
  return out;
}

/** A sample of each category, used by the "Send me a test" button and the preview. The links point at the farm's site. */
export function sampleMessage(category, baseUrl) {
  const at = (path) => new URL(path, baseUrl).href;
  switch (category) {
    case "signup_verification": return { subject: "Verify your email for Flockence", text: `Confirm this email address to create your Free Flockence farm. This single-use link expires after 30 minutes.\n\n${at("/signup/free")}` };
    case "welcome": return { subject: "Welcome to Flockence", text: `Your Flockence account is ready. Sign in to open your farm workspace.\n\n${at("/login")}` };
    case "password_reset": return { subject: "Flockence password reset", html: `<p>We received a request to reset your Flockence password.</p><p><a href="${escapeHtml(at("/forgot-password"))}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>` };
    case "team_invitation": return { subject: "Join your team on Flockence", text: `You were invited to join your farm on Flockence. Open this single-use link to create your account. It expires in 7 days.\n\n${at("/signup/team")}` };
    case "vision_daily_report": return { subject: "Farm Vision daily report (test)", text: "This is a test of the daily Farm Vision email. Real reports list what needs checking first, each area's condition and what the cameras covered.", html: "<p>This is a test of the daily Farm Vision email. Real reports list what needs checking first, each area's condition and what the cameras covered.</p>" };
    case "vision_alert": return { subject: "Farm Vision alert (test)", text: "This is a test of a Farm Vision alert. Real alerts name the pen, what was seen and what to check.", html: "<p>This is a test of a Farm Vision alert. Real alerts name the pen, what was seen and what to check.</p>" };
    default: return null;
  }
}
