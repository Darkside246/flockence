// What Farm Vision knows about the farm before it looks at a picture (2026-11-27). Pure parts, so they can be tested:
// which facts come first for each kind of check, and how they are written for the model, for people (shown on the
// Farm Vision page) and as formatted text (bold headings and lists) for Oriya's Operator Mode.

export const SECTION_TITLES = {
  FLOCK: "Flock", MORTALITY: "Deaths", FEED: "Feed", WATER: "Water", WEIGHT: "Weight", CONDITIONS: "House conditions",
  HEALTH: "Health and treatments", EGGS: "Eggs", PEN: "Pen", FINDINGS: "Open Vision findings", TIME: "Time",
  GUIDE_CHECK: "Your records against your guides", GUIDANCE: "What your guides say for this age",
};

// The facts that matter most for each kind of check come first; the rest follow in the usual order.
const FIRST = {
  PEN: ["PEN", "CONDITIONS", "GUIDE_CHECK", "FLOCK", "FINDINGS"],
  FLOCK: ["FLOCK", "MORTALITY", "CONDITIONS", "GUIDE_CHECK", "WEIGHT"],
  BIRD: ["HEALTH", "FLOCK", "MORTALITY", "CONDITIONS"],
  DEAD_BIRD: ["MORTALITY", "HEALTH", "FLOCK", "CONDITIONS"],
  DROPPINGS: ["HEALTH", "FEED", "WATER", "CONDITIONS"],
  FEED: ["FEED", "WEIGHT", "FLOCK", "PEN"],
  WATER: ["WATER", "CONDITIONS", "FEED", "PEN"],
  EQUIPMENT: ["PEN", "CONDITIONS", "FINDINGS"],
  OTHER: [],
};
const USUAL = ["TIME", "FLOCK", "MORTALITY", "FEED", "WATER", "WEIGHT", "CONDITIONS", "GUIDE_CHECK", "HEALTH", "EGGS", "PEN", "FINDINGS", "GUIDANCE"];

/** Sections [{key, lines}] in the order that suits the check; empty sections are dropped. */
export function orderSections(sections, category = "OTHER") {
  const order = [...new Set([...(FIRST[category] ?? []), ...USUAL])];
  const byKey = new Map(sections.filter((s) => s.lines.length).map((s) => [s.key, s]));
  const known = order.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
  const other = sections.filter((s) => s.lines.length && !order.includes(s.key));
  return [...known, ...other].map((s) => ({ key: s.key, title: s.title ?? SECTION_TITLES[s.key] ?? s.key, lines: s.lines }));
}

/** One paragraph for the model. */
export function contextText(sections) {
  return sections.map((s) => `${s.title}: ${s.lines.join("; ")}.`).join(" ");
}

/** Formatted text for people and for Oriya's Operator Mode: bold headings and bullet points. */
export function contextMarkdown(heading, sections, footer = "") {
  return [
    `**${heading}**`,
    ...sections.flatMap((s) => ["", `**${s.title}**`, ...s.lines.map((l) => `- ${l}`)]),
    ...(footer ? ["", `_${footer}_`] : []),
  ].join("\n");
}

const pct = (a, b) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

/** Feed lines: amount and grams per bird, today and the last 7 days (feed put out, from Feed records). */
export function feedLines({ kg24h, kg7d, live }) {
  const out = [];
  if (kg24h > 0) out.push(`${Math.round(kg24h * 10) / 10} kg in the last 24 hours${live > 0 ? ` (about ${Math.round((kg24h * 1000) / live)} g per bird)` : ""}`);
  if (kg7d > 0) out.push(`${Math.round(kg7d * 10) / 10} kg in the last 7 days`);
  if (!kg24h && !kg7d) out.push("no feed recorded in the last 7 days");
  return out;
}

/** Egg lines for layers: laying rate, floor and cracked eggs in the last 24 hours. */
export function eggLines({ total, floor, cracked, hens }) {
  if (!total) return ["no eggs recorded in the last 24 hours"];
  const rate = pct(total, hens);
  return [
    `${total} eggs in the last 24 hours${rate != null ? ` (${rate}% laying)` : ""}`,
    ...(floor ? [`${floor} floor eggs (${pct(floor, total)}%)`] : []),
    ...(cracked ? [`${cracked} cracked`] : []),
  ];
}
