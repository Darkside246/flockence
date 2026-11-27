// Vision reports (Vision Intelligence phase 1b): how a report decides each area's condition, the overall condition,
// the actions and the summary. Pure, so it can be tested. The report never invents a good condition: an area with no
// evidence is "Insufficient data", and a serious problem in one area is never averaged away by good areas.

export const AREAS = ["BIRDS", "THERMAL", "LITTER", "FEED_WATER", "EQUIPMENT", "POPULATION", "EGGS"];
export const AREA_LABELS = {
  BIRDS: "Bird condition and behaviour", THERMAL: "Heat and cold", LITTER: "Litter", FEED_WATER: "Feed and water",
  EQUIPMENT: "Equipment", POPULATION: "Bird numbers", EGGS: "Eggs (layers)",
};
export const STATUS_LABELS = {
  URGENT: "Urgent inspection required", ATTENTION: "Attention required", MONITOR: "Monitor",
  GOOD: "Good apparent condition", INSUFFICIENT_DATA: "Insufficient data",
};
const KIND_AREA = {
  DEAD_OR_DOWN_BIRD: "BIRDS", HEALTH: "BIRDS", BEHAVIOUR: "BIRDS", THERMAL: "THERMAL", LITTER: "LITTER",
  FEED_WATER: "FEED_WATER", EQUIPMENT: "EQUIPMENT", POPULATION: "POPULATION", FLOOR_EGGS: "EGGS",
};
const SIGNAL_AREA = { BEHAVIOR: "BIRDS", DISTRIBUTION: "BIRDS", VISIBLE_HEALTH: "BIRDS", COMFORT: "THERMAL", LITTER: "LITTER", FEED_WATER: "FEED_WATER", EQUIPMENT: "EQUIPMENT" };
const SEVERITY_STATUS = { CRITICAL: "URGENT", HIGH: "ATTENTION", MEDIUM: "MONITOR", INFO: "GOOD" };
const ORDER = ["URGENT", "ATTENTION", "MONITOR", "GOOD", "INSUFFICIENT_DATA"];
const worse = (a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const COUNTS = ["OBSERVED", "SUSPECTED", "REQUIRES_INSPECTION", "INCONCLUSIVE", "CONFIRMED"];

export const ACTIONS = {
  DEAD_OR_DOWN_BIRD: "Walk the pen and check the bird(s) noted. If a bird has died, remove it and record it in Daily Rounds.",
  HEALTH: "Look closely at the birds noted. Separate any that are unwell, and ask a vet if several are affected.",
  BEHAVIOUR: "Look for what is moving the birds: draughts, heat, uneven light, wet litter, or blocked feeders and drinkers.",
  THERMAL: "Check the temperature at bird height, the ventilation, and heater or fan settings for the flock's age.",
  LITTER: "Look for leaking drinkers and wet patches; turn or top up litter where it is wet.",
  FEED_WATER: "Check that feeders have feed and drinkers flow at the right height for the birds.",
  EQUIPMENT: "Inspect the equipment noted and fix anything broken or unsafe.",
  POPULATION: "Recount, or check for additions or moves not yet recorded. The official count has not been changed.",
  FLOOR_EGGS: "Collect floor eggs more often; check that nest boxes are open, clean, dim and enough for the hens, and that nothing keeps hens off the nests. Record floor eggs in the egg collection.",
};

/**
 * Each area's condition from the period's findings and inspections.
 * findings: [{kind, severity, state}], inspections: [{signals: [{category, state}], visibleBirds}]
 */
export function areaStatuses(findings, inspections) {
  const out = {};
  for (const area of AREAS) out[area] = { status: inspections.length ? "INSUFFICIENT_DATA" : "INSUFFICIENT_DATA", reasons: [], seen: false, fixed: 0 };
  for (const i of inspections) {
    for (const s of i.signals ?? []) {
      const area = SIGNAL_AREA[s?.category];
      if (area && s.state && s.state !== "NOT_OBSERVED") out[area].seen = true;
    }
    if (Number.isInteger(i.visibleBirds)) { out.POPULATION.seen = true; out.BIRDS.seen = true; }
    if (i.eggsSeen) out.EGGS.seen = true;
  }
  for (const f of findings) {
    const area = KIND_AREA[f.kind];
    if (!area) continue;
    out[area].seen = true;
    if (f.state === "RESOLVED") { out[area].fixed += 1; continue; }
    if (!COUNTS.includes(f.state)) continue;   // dismissed findings do not count
    const status = SEVERITY_STATUS[f.severity] ?? "MONITOR";
    out[area].status = out[area].status === "INSUFFICIENT_DATA" ? status : worse(out[area].status, status);
    out[area].reasons.push(f.title + (f.occurrences > 1 ? ` (seen ${f.occurrences} times)` : "") + (f.state === "CONFIRMED" ? ", confirmed" : ""));
  }
  for (const area of AREAS) if (out[area].status === "INSUFFICIENT_DATA" && out[area].seen && inspections.length) out[area].status = "GOOD";
  return out;
}

/** The worst area decides. With no view of the birds at all, the report cannot call the pen good. */
export function overallStatus(areas) {
  let overall = "INSUFFICIENT_DATA";
  for (const area of AREAS) if (areas[area].status !== "INSUFFICIENT_DATA") overall = overall === "INSUFFICIENT_DATA" ? areas[area].status : worse(overall, areas[area].status);
  if (overall === "GOOD" && areas.BIRDS.status === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA";
  return overall;
}

/** Actions from the open findings, most serious first, one per kind. */
export function rankedActions(findings) {
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };
  const seen = new Set();
  return [...findings].filter((f) => COUNTS.includes(f.state))
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .filter((f) => !seen.has(f.kind) && seen.add(f.kind))
    .map((f) => ({ kind: f.kind, severity: f.severity, finding: f.title, action: ACTIONS[f.kind] ?? "Check the area noted." }));
}

/** Parts of the farm's day that had at least one inspection (for the coverage note). */
export function dayParts(hours) {
  const parts = { night: [0, 5], morning: [5, 11], midday: [11, 15], afternoon: [15, 19], evening: [19, 24] };
  return Object.fromEntries(Object.entries(parts).map(([name, [a, b]]) => [name, hours.filter((h) => h >= a && h < b).length]));
}

/** Plain-language summary from the facts; nothing in it is generated beyond them. */
export function summarise({ scopeLabel, periodLabel, overall, actions, inspections, cameras, hoursCovered, hoursInPeriod }) {
  const lead = `${scopeLabel}, ${periodLabel}: ${STATUS_LABELS[overall]}.`;
  if (!inspections) return `${lead} No camera pictures or photo inspections in this period, so Vision cannot say how the birds are. Run a check on the Farm Vision page or switch on automatic inspections.`;
  const todo = actions.length ? ` ${actions.length === 1 ? "One thing needs" : `${actions.length} things need`} checking: ${actions.slice(0, 3).map((a) => a.finding.toLowerCase()).join("; ")}.` : " Nothing found that needs checking in what the cameras showed.";
  return `${lead}${todo} Based on ${inspections} inspection${inspections === 1 ? "" : "s"} from ${cameras} source${cameras === 1 ? "" : "s"}, covering ${hoursCovered} of ${hoursInPeriod} hours.`;
}
