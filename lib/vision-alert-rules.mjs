// Vision alerts (Vision Intelligence phase 1c, 2026-11-27). Pure rules, so they can be tested.
//
// An alert is about an incident (a finding grouped over 48 hours: lib/vision-findings-rules.mjs), not about each
// picture, so a bird lying by the wall seen in six pictures is one alert, not six. Then:
//  - only HIGH and CRITICAL findings alert; the rest wait for the daily report;
//  - a new incident alerts; so does one that gets worse (HIGH to CRITICAL);
//  - one still open after its cooldown (CRITICAL 4 hours, HIGH 12 hours) gets a reminder, at most 2 per incident;
//  - at most MAX_PER_HOUR alert emails a farm per hour; anything over that is held for the daily report.

export const ALERT_SEVERITIES = ["HIGH", "CRITICAL"];
export const COOLDOWN_MS = { CRITICAL: 4 * 3_600_000, HIGH: 12 * 3_600_000 };
export const MAX_REMINDERS = 2;
export const MAX_PER_HOUR = 6;
export const KEEP_MS = 14 * 86_400_000;
const OPEN = ["OBSERVED", "SUSPECTED", "REQUIRES_INSPECTION", "INCONCLUSIVE"];
const rank = (s) => ["INFO", "MEDIUM", "HIGH", "CRITICAL"].indexOf(s);

/**
 * Should this finding alert now? `finding`: {severity, state}; `last`: what was last sent for this incident
 * ({at (ms), severity, reminders}) or undefined. Returns "NEW", "WORSE", "STILL_THERE" or null.
 */
export function alertReason(finding, last, now) {
  if (!ALERT_SEVERITIES.includes(finding.severity) || !OPEN.includes(finding.state)) return null;
  if (!last) return "NEW";
  if (rank(finding.severity) > rank(last.severity)) return "WORSE";
  if ((last.reminders ?? 0) < MAX_REMINDERS && now - last.at >= (COOLDOWN_MS[finding.severity] ?? COOLDOWN_MS.HIGH)) return "STILL_THERE";
  return null;
}

/**
 * Which of an inspection's findings to send, given the farm's alert state, and the state after sending them.
 * state: {incidents: {[findingId]: {at, severity, reminders}}, sentAt: [ms]}. All findings from one inspection go
 * in one email, which counts once toward the hourly limit.
 */
export function planAlerts(findings, state, now) {
  const incidents = { ...(state?.incidents ?? {}) };
  for (const [id, v] of Object.entries(incidents)) if (now - v.at > KEEP_MS) delete incidents[id];
  const sentAt = (state?.sentAt ?? []).filter((t) => now - t < 3_600_000);
  const send = [];
  for (const f of findings) {
    const reason = alertReason(f, incidents[f.id], now);
    if (reason) send.push({ ...f, reason });
  }
  if (!send.length) return { send: [], held: false, state: { incidents, sentAt } };
  if (sentAt.length >= MAX_PER_HOUR) return { send: [], held: true, state: { incidents, sentAt } };
  for (const f of send) {
    const prev = incidents[f.id];
    incidents[f.id] = { at: now, severity: f.severity, reminders: f.reason === "STILL_THERE" ? (prev?.reminders ?? 0) + 1 : 0 };
  }
  return { send, held: false, state: { incidents, sentAt: [...sentAt, now] } };
}

const REASON_TEXT = { NEW: "New", WORSE: "Worse", STILL_THERE: "Still there" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** One alert email for the findings of one inspection. */
export function alertEmail(findings, farmName, whenLabel, link) {
  const worst = findings.some((f) => f.severity === "CRITICAL") ? "Urgent" : "Check soon";
  const where = [...new Set(findings.map((f) => f.penName || f.cameraName).filter(Boolean))];
  const subject = `${worst}: ${findings[0].title}${findings.length > 1 ? ` and ${findings.length - 1} more` : ""} (${farmName})`;
  const line = (f) => `${REASON_TEXT[f.reason]}: ${f.title}${f.penName ? `, ${f.penName}` : ""}${f.cameraName ? ` (camera ${f.cameraName})` : ""}. ${f.detail ?? ""}`.trim();
  const text = [
    `${farmName}, Farm Vision alert, ${whenLabel}${where.length ? `, ${where.join(", ")}` : ""}`,
    "",
    ...findings.map((f) => `- ${line(f)}`),
    "",
    "Please check in person. Vision can be wrong: it sees only what the camera shows, and it never changes your records.",
    `Review it (confirm, dismiss or mark fixed): ${link}`,
    "To stop alert emails, untick \"Farm alerts\" on your Account page.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;color:#101828;line-height:1.5">
<p style="margin:0;color:#475467;font-size:13px">${esc(farmName)} · Farm Vision alert · ${esc(whenLabel)}</p>
<h2 style="margin:6px 0 8px;color:${worst === "Urgent" ? "#b42318" : "#b54708"}">${esc(worst)}</h2>
<ul>${findings.map((f) => `<li><strong>${esc(REASON_TEXT[f.reason])}: ${esc(f.title)}</strong>${f.penName ? `, ${esc(f.penName)}` : ""}${f.cameraName ? ` (camera ${esc(f.cameraName)})` : ""}. ${esc(f.detail ?? "")}</li>`).join("")}</ul>
<p>Please check in person. Vision can be wrong: it sees only what the camera shows, and it never changes your records.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#175cd3;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review it</a></p>
<p style="color:#667085;font-size:12px">To stop alert emails, untick "Farm alerts" on your Account page.</p>
</div>`;
  return { subject, text, html };
}
