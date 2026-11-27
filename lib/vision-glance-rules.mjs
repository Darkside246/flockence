// Farm Vision reports made quick to read, and bird counts made closer to the truth (2026-11-27). Pure, so they can be
// tested.
//
// At a glance: one line per area (birds, behaviour, health, feed and water, litter, heat and air, equipment), each OK,
// Check, Urgent or Not seen, from what the inspection saved; then the top things to do. Works for old reports too.
//
// Counting: the model counts a 3x3 grid of the picture (birds whose body centre is in each cell) and the cells are
// added up, which is steadier than one guess for the whole picture. Then each camera learns from the farm's real
// counts: if a camera usually shows 85% of the birds in its pen, its counts are scaled to the pen. Records are never
// changed by any of this.

const SHORT = 110;
const short = (s) => { const t = String(s ?? "").trim(); return t.length > SHORT ? t.slice(0, SHORT - 1).replace(/\s+\S*$/, "") + "…" : t; };
const LEVEL = { NOT_OBSERVED: "NOT_SEEN", NORMAL: "OK", ATTENTION: "CHECK", WARNING: "CHECK", CRITICAL: "URGENT" };
const RANK = { URGENT: 3, CHECK: 2, OK: 1, NOT_SEEN: 0 };
const AREAS = [
  ["Behaviour and spread", ["BEHAVIOR", "DISTRIBUTION"]],
  ["Visible health", ["VISIBLE_HEALTH"]],
  ["Feed and water", ["FEED_WATER"]],
  ["Litter", ["LITTER"]],
  ["Heat and air", ["COMFORT"]],
  ["Equipment", ["EQUIPMENT"]],
];

/** The total from a 3x3 grid count (9 whole numbers), or null when the grid is missing or broken. */
export function gridTotal(byArea) {
  if (!Array.isArray(byArea) || byArea.length !== 9 || !byArea.every((n) => Number.isInteger(n) && n >= 0 && n <= 2000)) return null;
  return byArea.reduce((a, b) => a + b, 0);
}

/**
 * How much a camera misses: the middle of the farm's recent actual/counted ratios (at least 2, last 10), kept between
 * 1.0 and 2.0 so one odd answer cannot swing it. null until there are 2 good samples.
 */
export function cameraFactor(samples) {
  const ratios = (samples ?? []).slice(-10).filter((s) => s.counted > 0 && s.actual > 0).map((s) => s.actual / s.counted).sort((a, b) => a - b);
  if (ratios.length < 2) return null;
  const m = ratios.length >> 1;
  const median = ratios.length % 2 ? ratios[m] : (ratios[m - 1] + ratios[m]) / 2;
  return Math.round(Math.min(2, Math.max(1, median)) * 100) / 100;
}

/** The pen estimate from a count in view and the camera's factor. */
export function penEstimate(visible, samples) {
  const factor = cameraFactor(samples);
  if (!Number.isInteger(visible) || factor == null) return null;
  return { estimate: Math.round(visible * factor), factor, samples: Math.min(10, (samples ?? []).length), shows: Math.round(100 / factor) };
}

/** The birds line: in view, the camera-adjusted pen estimate, the records, and still birds. */
export function birdsLine({ visible = null, confidence = null, estimate = null, recorded = null, still = 0 }) {
  const parts = [];
  if (Number.isInteger(visible)) parts.push(`about ${visible} in view${confidence ? ` (${String(confidence).toLowerCase()} confidence)` : ""}`);
  if (estimate) parts.push(`about ${estimate.estimate} in the pen (this camera usually shows ${estimate.shows}% of the birds, from ${estimate.samples} of your counts)`);
  if (Number.isInteger(recorded)) parts.push(`${recorded} in your records`);
  parts.push(still ? `${still} possible dead or down bird${still === 1 ? "" : "s"}: check now` : "none lying still");
  const level = still ? "URGENT" : !Number.isInteger(visible) ? "NOT_SEEN" : "OK";
  return { area: "Birds", level, text: parts.join(" · ") };
}

/**
 * At a glance, from a saved assessment ({status, summary, checks, signals: [{category, state, evidence}], birds?})
 * and the counts. Returns {headline, status, rows: [{area, level, text}], todo: [string], notSeen: [area]}.
 */
export function glance(assessment, birds = {}) {
  const signals = Array.isArray(assessment?.signals) ? assessment.signals : [];
  const rows = [birdsLine(birds)];
  for (const [area, cats] of AREAS) {
    const own = signals.filter((s) => cats.includes(s?.category));
    const worst = own.reduce((w, s) => (RANK[LEVEL[s.state] ?? "NOT_SEEN"] > RANK[w.level] ? { level: LEVEL[s.state], text: s.evidence } : w), { level: "NOT_SEEN", text: "" });
    rows.push({ area, level: worst.level, text: worst.level === "NOT_SEEN" ? "not seen in this picture" : worst.level === "OK" ? short(worst.text) || "looks fine" : short(worst.text) || "needs a look" });
  }
  return {
    headline: short(assessment?.summary ?? ""),
    status: assessment?.status ?? "INSUFFICIENT_EVIDENCE",
    rows,
    todo: (Array.isArray(assessment?.checks) ? assessment.checks : []).slice(0, 3).map(short),
    notSeen: rows.filter((r) => r.level === "NOT_SEEN").map((r) => r.area),
  };
}

/** The count and its confidence from an older report's saved text ("Birds visible: about 80 (low confidence)."). */
export function birdsFromNotes(notes) {
  const m = String(notes ?? "").match(/Birds visible: about (\d+)(?: \((low|medium|high) confidence\))?/i);
  return m ? { visible: Number(m[1]), confidence: m[2] ? m[2].toUpperCase() : null } : { visible: null, confidence: null };
}
