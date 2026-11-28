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
  // Also check saved recordings across the day (lib/vision-recording-rules.mjs), within the same daily limit.
  const recordings = input.recordings === true;
  return { ok: true, schedule: { enabled, cameras, dailyCap, keepDays, quietStart, quietEnd, recordings } };
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

// ── Plan limits (owner, 2026-11-27: automatic checks must pay for themselves) ─────────────────────────────────────
// Each plan gets a ceiling. The farm chooses within it; the server enforces it on save and again on every round.
// Change the numbers without code: VISION_PLAN_LIMITS='{"PREMIUM":{"dailyCap":48}}' (merged over these defaults).
// Free (owner, 2026-11-27): photo checks by hand (10 a month), findings, reports and the daily email; no cameras or
// automatic checks.
export const DEFAULT_PLAN_LIMITS = {
  FREE: { automatic: false, maxCameras: 0, minIntervalHours: 24, dailyCap: 0, manualPerMonth: 10, monthlyBudgetUsd: 0 },
  STANDARD: { automatic: true, maxCameras: 1, minIntervalHours: 6, dailyCap: 3, manualPerMonth: 30, monthlyBudgetUsd: 1 },
  PREMIUM: { automatic: true, maxCameras: 8, minIntervalHours: 1, dailyCap: 24, manualPerMonth: 300, monthlyBudgetUsd: 10 },
};
export const PLAN_LABELS = { FREE: "Free", STANDARD: "Standard", PREMIUM: "Premium" };

/** The plan for a farm: its access state (FREE, EXISTING, PREMIUM) or a farm listed in VISION_PREMIUM_FARMS. */
export function visionPlan(accessState, farmId, premiumFarms = "") {
  if (String(premiumFarms).split(",").map((s) => s.trim()).filter(Boolean).includes(farmId)) return "PREMIUM";
  if (accessState === "PREMIUM") return "PREMIUM";
  if (accessState === "EXISTING" || accessState === "STANDARD") return "STANDARD";
  return "FREE";
}

export function planLimits(plan, overridesText = "") {
  const base = { ...(DEFAULT_PLAN_LIMITS[plan] ?? DEFAULT_PLAN_LIMITS.FREE) };
  let overrides = {};
  try { overrides = JSON.parse(overridesText || "{}"); } catch { /* keep defaults */ }
  const extra = overrides && typeof overrides === "object" ? overrides[plan] : null;
  if (extra && typeof extra === "object") {
    if (typeof extra.automatic === "boolean") base.automatic = extra.automatic;
    for (const key of ["maxCameras", "minIntervalHours", "dailyCap", "manualPerMonth", "monthlyBudgetUsd"]) {
      const n = Number(extra[key]);
      if (extra[key] !== undefined && Number.isFinite(n) && n >= 0) base[key] = n;
    }
  }
  return base;
}

/** Check a schedule against the plan before saving. Over the limit says so plainly; the daily cap is lowered to fit. */
export function fitScheduleToPlan(schedule, limits, planLabel = "current") {
  if (!schedule.enabled) return { ok: true, schedule };
  if (!limits.automatic) return { ok: false, error: `Automatic inspections are not included in the ${planLabel} plan. Upgrade to Premium to switch them on.` };
  const names = Object.keys(schedule.cameras);
  if (names.length > limits.maxCameras) return { ok: false, error: `The ${planLabel} plan includes automatic checks on ${limits.maxCameras} camera${limits.maxCameras === 1 ? "" : "s"}. Choose fewer, or upgrade to Premium.` };
  for (const name of names) {
    if (schedule.cameras[name].everyHours < limits.minIntervalHours) {
      return { ok: false, error: `The ${planLabel} plan checks each camera at most every ${limits.minIntervalHours} hour${limits.minIntervalHours === 1 ? "" : "s"}. Choose a longer time for ${name}, or upgrade to Premium.` };
    }
  }
  return { ok: true, schedule: { ...schedule, dailyCap: Math.max(1, Math.min(schedule.dailyCap, limits.dailyCap)) } };
}

/** What a round may actually run: the saved schedule cut down to the plan (in case the plan changed since). */
export function scheduleWithinPlan(schedule, limits) {
  if (!schedule?.enabled || !limits.automatic || limits.maxCameras < 1) return null;
  const cameras = Object.fromEntries(Object.entries(schedule.cameras).slice(0, limits.maxCameras)
    .map(([name, c]) => [name, { ...c, everyHours: Math.max(c.everyHours, limits.minIntervalHours) }]));
  return { ...schedule, cameras, dailyCap: Math.min(schedule.dailyCap, limits.dailyCap) };
}

/** Has the month's vision spend reached the plan's budget? (Budget 0 means no automatic spending.) */
export function overBudget(costMicros, limits) {
  return costMicros >= limits.monthlyBudgetUsd * 1_000_000;
}
