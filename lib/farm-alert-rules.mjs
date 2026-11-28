/**
 * Farm alert emails (owner, 28 Nov 2026: notifications beyond Farm Vision). The dashboard's briefing already works out
 * what needs attention from the farm's own records (lib/farm-briefing.ts). These pure rules decide which of those items
 * to email, and when, so nobody is flooded:
 *  - only "urgent" and "attention" items, each at most once a farm day;
 *  - Farm Vision items are left out (they have their own alert emails);
 *  - end-of-day tasks (today's daily check, today's egg collection) only from 15:00 farm time;
 *  - quiet hours 21:00-06:00 farm time, unless something is urgent;
 *  - at most one email every two hours, unless something new is urgent.
 */

export const QUIET_FROM = 21;
export const QUIET_TO = 6;
export const LATE_DAY_FROM = 15;
export const MIN_GAP_MS = 2 * 3_600_000;
const LATE_DAY_PREFIXES = ["check-", "eggs-"];
const VISION_PREFIX = "vision";

export function alertable(item, hour) {
  if (item.tone !== "urgent" && item.tone !== "attention") return false;
  if (String(item.id).startsWith(VISION_PREFIX)) return false;
  if (LATE_DAY_PREFIXES.some((p) => String(item.id).startsWith(p)) && hour < LATE_DAY_FROM) return false;
  return true;
}

export const isQuiet = (hour) => hour >= QUIET_FROM || hour < QUIET_TO;

/**
 * Decide this round. items: briefing items; state: {date, sent: {itemId: iso}, lastEmailAt} or null;
 * local: {date, hour} in farm time; nowMs: the current time.
 * Returns {send: false, state} or {send: true, items (urgent first; fresh ones flagged), state (already updated)}.
 */
export function planFarmAlerts(items, state, local, nowMs) {
  const today = state && state.date === local.date ? state : { date: local.date, sent: {}, lastEmailAt: state?.lastEmailAt ?? null };
  const current = items.filter((i) => alertable(i, local.hour));
  const fresh = current.filter((i) => !today.sent[i.id]);
  if (!fresh.length) return { send: false, state: today };
  const freshUrgent = fresh.some((i) => i.tone === "urgent");
  if (isQuiet(local.hour) && !freshUrgent) return { send: false, state: today };
  const last = today.lastEmailAt ? Date.parse(today.lastEmailAt) : NaN;
  if (Number.isFinite(last) && nowMs - last < MIN_GAP_MS && !freshUrgent) return { send: false, state: today };
  const at = new Date(nowMs).toISOString();
  const sent = { ...today.sent };
  for (const i of current) sent[i.id] ??= at;
  const ordered = [...current].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "urgent" ? -1 : 1))
    .map((i) => ({ ...i, fresh: !today.sent[i.id] }));
  return { send: true, items: ordered, state: { date: local.date, sent, lastEmailAt: at } };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** The email for one round's items. link: the dashboard; base: the site, for each item's own link. */
export function farmAlertEmail(items, farmName, link, base) {
  const urgent = items.filter((i) => i.tone === "urgent").length;
  const count = items.length;
  const subject = urgent
    ? `${farmName}: ${urgent} urgent ${urgent === 1 ? "item" : "items"} on the farm`
    : `${farmName}: ${count} ${count === 1 ? "thing needs" : "things need"} attention`;
  const href = (i) => { try { return i.action ? new URL(i.action.href, base).href : null; } catch { return null; } };
  const line = (i) => `${i.tone === "urgent" ? "URGENT: " : ""}${i.fresh ? "" : "(still open) "}${i.text}${href(i) ? `\n  ${i.action.label}: ${href(i)}` : ""}`;
  const text = [`From your farm records in Flockence:`, ...items.map((i) => "- " + line(i)), "", `Open the farm overview: ${link}`,
    "You get these because Farm alerts is ticked on your Account page. Untick it there to stop them."].join("\n");
  const html = `<p>From your farm records in Flockence:</p><ul>${items.map((i) => `<li>${i.tone === "urgent" ? "<strong>Urgent:</strong> " : ""}${i.fresh ? "" : "<em>(still open)</em> "}${escapeHtml(i.text)}${href(i) ? ` <a href="${escapeHtml(href(i))}">${escapeHtml(i.action.label)}</a>` : ""}</li>`).join("")}</ul>`
    + `<p><a href="${escapeHtml(link)}">Open the farm overview</a></p><p style="color:#666;font-size:12px">You get these because Farm alerts is ticked on your Account page. Untick it there to stop them.</p>`;
  return { subject, text, html };
}
