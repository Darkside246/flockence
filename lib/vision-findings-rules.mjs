// Vision findings (Vision Intelligence phase 1, 2026-11-27): turning one inspection's answer into findings a farmer can
// check, and grouping repeat sightings into one incident. Pure, so it can be tested. Used by lib/vision-findings.ts.
//
// A finding is never a record of fact. Its state says how far it got:
//   OBSERVED, SUSPECTED, REQUIRES_INSPECTION, INCONCLUSIVE   (open: from Vision)
//   CONFIRMED, DISMISSED, RESOLVED                           (closed: by a person)
// Vision never changes mortality, live counts, feed, water or eggs.

export const KINDS = ["DEAD_OR_DOWN_BIRD", "THERMAL", "LITTER", "FEED_WATER", "EQUIPMENT", "HEALTH", "BEHAVIOUR", "POPULATION"];
export const SEVERITIES = ["INFO", "MEDIUM", "HIGH", "CRITICAL"];
export const OPEN_STATES = ["OBSERVED", "SUSPECTED", "REQUIRES_INSPECTION", "INCONCLUSIVE"];
export const REVIEW_STATES = ["CONFIRMED", "DISMISSED", "RESOLVED"];
export const KIND_LABELS = {
  DEAD_OR_DOWN_BIRD: "Possible dead or down bird", THERMAL: "Heat or cold behaviour", LITTER: "Litter",
  FEED_WATER: "Feed and water access", EQUIPMENT: "Equipment", HEALTH: "Visible health signs",
  BEHAVIOUR: "Flock behaviour and spread", POPULATION: "Bird numbers",
};
/** A repeat sighting within this time joins the open incident instead of starting a new one. */
export const INCIDENT_WINDOW_MS = 48 * 3_600_000;

const SIGNAL_KIND = { COMFORT: "THERMAL", LITTER: "LITTER", FEED_WATER: "FEED_WATER", EQUIPMENT: "EQUIPMENT", VISIBLE_HEALTH: "HEALTH", BEHAVIOR: "BEHAVIOUR", DISTRIBUTION: "BEHAVIOUR" };
const SIGNAL_SEVERITY = { ATTENTION: "MEDIUM", WARNING: "HIGH", CRITICAL: "CRITICAL" };
const rank = (s) => Math.max(0, SEVERITIES.indexOf(s));
export const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/**
 * Findings from one inspection answer. `expectedLive` is the ledger's live count for the flock (or null);
 * `visible` is the model's count of birds in view.
 */
export function findingsFromAnalysis(analysis, { expectedLive = null } = {}) {
  const out = [];
  const still = Array.isArray(analysis?.stillBirds) ? analysis.stillBirds : [];
  if (still.length) {
    out.push({
      kind: "DEAD_OR_DOWN_BIRD", severity: still.length >= 3 ? "CRITICAL" : "HIGH", state: "REQUIRES_INSPECTION",
      confidence: still.map((b) => b.confidence).find(Boolean) ?? null,
      title: still.length === 1 ? `Possible dead or down bird ${still[0].where}` : `${still.length} possible dead or down birds`,
      detail: still.map((b) => `${b.where}${b.why ? ": " + b.why : ""}`).join("; "),
    });
  }
  const byKind = new Map();
  for (const signal of Array.isArray(analysis?.signals) ? analysis.signals : []) {
    const kind = SIGNAL_KIND[signal?.category];
    const severity = SIGNAL_SEVERITY[signal?.state];
    if (!kind || !severity) continue;
    const current = byKind.get(kind);
    byKind.set(kind, current
      ? { ...current, severity: higher(current.severity, severity), detail: `${current.detail}; ${signal.evidence ?? ""}` }
      : { kind, severity, state: "SUSPECTED", confidence: analysis?.confidence ?? null, title: KIND_LABELS[kind], detail: signal.evidence ?? "" });
  }
  out.push(...byKind.values());
  const visible = analysis?.birdCount?.visible;
  if (Number.isInteger(visible) && Number.isInteger(expectedLive) && expectedLive >= 0 && visible > expectedLive + Math.max(2, expectedLive * 0.05)) {
    out.push({
      kind: "POPULATION", severity: "MEDIUM", state: "REQUIRES_INSPECTION", confidence: analysis.birdCount.confidence ?? null,
      title: "More birds in view than the records show",
      detail: `About ${visible} birds in view; the records give ${expectedLive} live. Check for unrecorded additions or moves, or a miscount. The official count is not changed.`,
    });
  }
  return out;
}

/** The grouping key: the same kind of problem in the same pen (or camera, when no pen) is one incident. */
export function incidentKey(kind, { penId = null, cameraName = null } = {}) {
  return `${kind}|${penId ? "pen:" + penId : cameraName ? "cam:" + cameraName : "farm"}`;
}

/** Should this sighting join an existing incident? Only an open one, seen recently. */
export function joinsIncident(existing, now) {
  return Boolean(existing) && OPEN_STATES.includes(existing.state) && now.getTime() - new Date(existing.lastSeenAt).getTime() <= INCIDENT_WINDOW_MS;
}

/** A person's review. Returns the new state and the history line, or an error. The original wording is kept. */
export function reviewFinding(current, input, by, now) {
  if (!REVIEW_STATES.includes(input?.state)) return { ok: false, error: "Choose confirmed, not a problem, or resolved." };
  if (current.state === input.state) return { ok: false, error: "The finding already has that state." };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  return { ok: true, state: input.state, entry: { at: now.toISOString(), from: current.state, to: input.state, by, note } };
}
