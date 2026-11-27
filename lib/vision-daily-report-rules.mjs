// The daily Vision email (Vision Intelligence phase 1c, 2026-11-27). Pure rules, so they can be tested: when a farm's
// report is due, whether there is anything to send, and the email itself (plain text and simple HTML).

export const DEFAULT_SETTINGS = { enabled: true, hour: 7 };

/** A farm's saved settings, or the defaults (on, 07:00 farm time). */
export function parseSettings(value) {
  try {
    const s = JSON.parse(value ?? "");
    return { enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_SETTINGS.enabled, hour: Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23 ? s.hour : DEFAULT_SETTINGS.hour };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Is today's report due? `local` is the farm's date (YYYY-MM-DD) and hour now. It is due from the chosen hour until the
 * end of the farm's day, until it has been sent (state.date === today and state.done). Checked every 10 minutes, so a
 * failed send is tried again on the next round the same day; a missed day is never sent late.
 */
export function isDue(settings, local, state) {
  if (!settings.enabled || local.hour < settings.hour) return false;
  return !(state?.date === local.date && state.done);
}

/** Recipients still to send to today: owners and managers who chose "Farm reports" email, minus those already sent. */
export function recipientsToSend(users, state, today) {
  const sent = new Set(state?.date === today ? state.sentTo ?? [] : []);
  return users.filter((u) => (u.role === "OWNER" || u.role === "MANAGER") && u.wantsReports && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email) && !u.email.endsWith(".invalid") && !sent.has(u.id));
}

/** A report with no pictures and nothing open would only say "no data" every day, so it is not sent. */
export function worthSending(report) {
  return report.coverage.inspections > 0 || report.actions.length > 0;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Subject, plain text and HTML for one farm's daily report. `link` opens the Vision tab. */
export function dailyEmail(report, farmName, dateLabel, link) {
  const subject = `${farmName}: ${report.overall.label} (Farm Vision, ${dateLabel})`;
  const areas = report.areas.filter((a) => a.status !== "GOOD" && a.status !== "INSUFFICIENT_DATA");
  const unseen = report.areas.filter((a) => a.status === "INSUFFICIENT_DATA").map((a) => a.label);
  const flocks = report.flocks.map((f) => `${f.name}: day ${f.ageDays}, ${f.liveRecorded ?? "?"} live in your records, ${f.deathsInPeriod} death${f.deathsInPeriod === 1 ? "" : "s"} recorded, ${f.feedKgInPeriod} kg feed`);
  const cov = report.coverage;
  const coverage = `${cov.inspections} inspection${cov.inspections === 1 ? "" : "s"}, pictures in ${cov.hoursCovered} of ${cov.hoursInPeriod} hours.${cov.silentCameras.length ? ` No pictures from: ${cov.silentCameras.join(", ")}.` : ""}`;

  const text = [
    `${farmName}, Farm Vision report for ${dateLabel}`,
    "",
    report.summary,
    report.actions.length ? "\nWhat to do, most important first:" : "",
    ...report.actions.map((a, i) => `${i + 1}. ${a.finding}. ${a.action}`),
    areas.length ? "\nNeeds attention:" : "",
    ...areas.map((a) => `- ${a.label}: ${a.statusLabel}. ${a.reasons.join("; ")}`),
    unseen.length ? `\nNot seen in the last 24 hours: ${unseen.join(", ")}.` : "",
    flocks.length ? "\nYour records:" : "",
    ...flocks.map((f) => `- ${f}`),
    `\nBased on: ${coverage}`,
    `\nOpen the full report: ${link}`,
    "\nVision reports what the cameras and photos show. It never changes your records and does not diagnose disease.",
    "To stop these emails, untick \"Farm reports\" on your Account page.",
  ].filter((line) => line !== "").join("\n");

  const tone = { URGENT: "#b42318", ATTENTION: "#b54708", MONITOR: "#175cd3", GOOD: "#067647" }[report.overall.status] ?? "#475467";
  const list = (items) => items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;color:#101828;line-height:1.5">
<p style="margin:0;color:#475467;font-size:13px">${esc(farmName)} · Farm Vision · ${esc(dateLabel)}</p>
<h2 style="margin:6px 0 8px;color:${tone}">${esc(report.overall.label)}</h2>
<p>${esc(report.summary)}</p>
${report.actions.length ? `<h3 style="margin:16px 0 4px">What to do, most important first</h3><ol>${report.actions.map((a) => `<li><strong>${esc(a.finding)}.</strong> ${esc(a.action)}</li>`).join("")}</ol>` : ""}
${areas.length ? `<h3 style="margin:16px 0 4px">Needs attention</h3>${list(areas.map((a) => `<strong>${esc(a.label)}</strong>: ${esc(a.statusLabel)}. ${esc(a.reasons.join("; "))}`))}` : ""}
${unseen.length ? `<p style="color:#475467">Not seen in the last 24 hours: ${esc(unseen.join(", "))}.</p>` : ""}
${flocks.length ? `<h3 style="margin:16px 0 4px">Your records</h3>${list(flocks.map(esc))}` : ""}
<p style="color:#475467;font-size:13px">Based on: ${esc(coverage)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#175cd3;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the full report</a></p>
<p style="color:#667085;font-size:12px">Vision reports what the cameras and photos show. It never changes your records and does not diagnose disease. To stop these emails, untick "Farm reports" on your Account page.</p>
</div>`;
  return { subject, text, html };
}
