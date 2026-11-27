// Automatic camera vision: the pure rules (what the settings may hold, when a camera is due, quiet hours, the daily
// limit). No database or clock of its own, so it can be tested. Used by lib/vision-schedule.ts.

export const SCHEDULE_KEY = "VISION_AUTO_V1";
export const STATE_KEY = "VISION_AUTO_STATE_V1";
export const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
export const MODES = ["video", "still"];
export const CATEGORIES = ["PEN", "FLOCK", "FEED", "WATER", "EQUIPMENT", "OTHER"];
export const LIMITS = { dailyCapMin: 1, dailyCapMax: 96, keepDaysMin: 1, keepDaysMax: 365, camerasMax: 24 };
export const DEFAULTS = { dailyCap: 24, keepDays: 30, quietStart: "", quietEnd: "" };
/** At most this many cameras are inspected in one round; the rest wait for the next round (the timer runs often). */
export const CAMERAS_PER_ROUND = 4;
/** A failing camera is shown as needing attention after this many failures in a row. */
export const ATTENTION_AFTER_FAILURES = 3;
/** A round holds the farm for at most this long, so a crashed round never blocks the next ones for good. */
export const LEASE_MS = 15 * 60 * 1000;

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const isName = (v) => typeof v === "string" && v.length > 0 && v.length <= 128 && !/[\/\\\u0000-\u001f\u007f]/.test(v);
const int = (v) => (typeof v === "number" ? v : Number(v));

/** Check and normalise what an owner or manager submitted. Returns { ok, schedule } or { ok: false, error }. */
export function normaliseSchedule(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Send the schedule." };
  const enabled = input.enabled === true;
  const dailyCap = int(input.dailyCap ?? DEFAULTS.dailyCap);
  if (!Number.isInteger(dailyCap) || dailyCap < LIMITS.dailyCapMin || dailyCap > LIMITS.dailyCapMax) {
    return { ok: false, error: `The daily limit must be a whole number from ${LIMITS.dailyCapMin} to ${LIMITS.dailyCapMax}.` };
  }
  const keepDays = int(input.keepDays ?? DEFAULTS.keepDays);
  if (!Number.isInteger(keepDays) || keepDays < LIMITS.keepDaysMin || keepDays > LIMITS.keepDaysMax) {
    return { ok: false, error: `Keep pictures for ${LIMITS.keepDaysMin} to ${LIMITS.keepDaysMax} days.` };
  }
  const quietStart = input.quietStart ? String(input.quietStart) : "";
  const quietEnd = input.quietEnd ? String(input.quietEnd) : "";
  if ((quietStart && !hhmm.test(quietStart)) || (quietEnd && !hhmm.test(quietEnd)) || Boolean(quietStart) !== Boolean(quietEnd)) {
    return { ok: false, error: "Quiet hours need both a start and an end time (HH:MM), or neither." };
  }
  const rawCameras = input.cameras && typeof input.cameras === "object" && !Array.isArray(input.cameras) ? input.cameras : {};
  const entries = Object.entries(rawCameras);
  if (entries.length > LIMITS.camerasMax) return { ok: false, error: `At most ${LIMITS.camerasMax} cameras can be scheduled.` };
  const cameras = {};
  for (const [name, value] of entries) {
    if (!isName(name) || !value || typeof value !== "object") return { ok: false, error: "A camera in the schedule is not valid." };
    const everyHours = int(value.everyHours);
    if (!INTERVAL_HOURS.includes(everyHours)) return { ok: false, error: `Choose how often for ${name}.` };
    const mode = MODES.includes(value.mode) ? value.mode : "video";
    const category = CATEGORIES.includes(value.category) ? value.category : "PEN";
    cameras[name] = { everyHours, mode, category };
  }
  if (enabled && entries.length === 0) return { ok: false, error: "Choose at least one camera, or switch automatic inspections off." };
  return { ok: true, schedule: { enabled, cameras, dailyCap, keepDays, quietStart, quietEnd } };
}

/** Read a stored schedule; anything unreadable counts as switched off. */
export function readSchedule(text) {
  try { const checked = normaliseSchedule(JSON.parse(text ?? "")); return checked.ok ? checked.schedule : null; } catch { return null; }
}

export function readState(text) {
  try {
    const value = JSON.parse(text ?? "");
    if (value && typeof value === "object" && !Array.isArray(value)) return {
      day: typeof value.day === "string" ? value.day : "", runsToday: Number.isInteger(value.runsToday) ? value.runsToday : 0,
      leaseUntil: typeof value.leaseUntil === "string" ? value.leaseUntil : "", lastRoundAt: typeof value.lastRoundAt === "string" ? value.lastRoundAt : "", cameras: value.cameras && typeof value.cameras === "object" ? value.cameras : {},
    };
  } catch { /* fall through */ }
  return { day: "", runsToday: 0, leaseUntil: "", lastRoundAt: "", cameras: {} };
}

/** "HH:MM" of `now` in the farm's time zone. */
export function clockInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/** Inside quiet hours? Handles a window that crosses midnight (19:00 to 06:00). */
export function inQuietHours(clock, quietStart, quietEnd) {
  if (!quietStart || !quietEnd || quietStart === quietEnd) return false;
  return quietStart < quietEnd ? clock >= quietStart && clock < quietEnd : clock >= quietStart || clock < quietEnd;
}

/** Due when the last attempt was at least its interval ago. Five minutes early still counts, so a 10-minute timer
 *  never pushes a camera a whole round late. */
export function isDue(lastRunAt, everyHours, now) {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= everyHours * 3600_000 - 5 * 60_000;
}

/** Which cameras to inspect this round, most overdue first, within the daily limit and the per-round limit. */
export function camerasToRun(schedule, state, now, today) {
  if (!schedule?.enabled) return [];
  const used = state.day === today ? state.runsToday : 0;
  const left = Math.max(0, schedule.dailyCap - used);
  const due = Object.entries(schedule.cameras)
    .filter(([name, c]) => isDue(state.cameras[name]?.lastRunAt, c.everyHours, now))
    .sort(([a], [b]) => (Date.parse(state.cameras[a]?.lastRunAt ?? "") || 0) - (Date.parse(state.cameras[b]?.lastRunAt ?? "") || 0));
  return due.slice(0, Math.min(left, CAMERAS_PER_ROUND)).map(([name, c]) => ({ name, ...c }));
}

/** Roughly how many inspections a day the schedule asks for (before quiet hours and the daily limit). */
export function inspectionsPerDay(schedule, quietMinutes = 0) {
  if (!schedule) return 0;
  const awake = Math.max(0, 24 * 60 - quietMinutes) / 60;
  const wanted = Object.values(schedule.cameras).reduce((sum, c) => sum + Math.ceil(awake / c.everyHours), 0);
  return Math.min(wanted, schedule.dailyCap);
}

export function quietMinutes(quietStart, quietEnd) {
  if (!quietStart || !quietEnd || quietStart === quietEnd) return 0;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = toMin(quietEnd) - toMin(quietStart);
  return d > 0 ? d : d + 24 * 60;
}

/** The camera's line in the state after an attempt. */
export function recordAttempt(previous, now, outcome) {
  const failures = outcome.ok ? 0 : (previous?.failures ?? 0) + 1;
  return {
    lastRunAt: now.toISOString(),
    lastResult: outcome.ok ? "ok" : "failed",
    lastMessage: outcome.ok ? (outcome.summary ?? "").slice(0, 240) : String(outcome.error ?? "Failed").slice(0, 240),
    lastObservationId: outcome.ok ? outcome.observationId : previous?.lastObservationId ?? null,
    lastSeverity: outcome.ok ? outcome.severity ?? null : previous?.lastSeverity ?? null,
    failures,
    needsAttention: failures >= ATTENTION_AFTER_FAILURES,
  };
}
