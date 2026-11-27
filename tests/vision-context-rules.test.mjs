import test from "node:test";
import assert from "node:assert/strict";
import { orderSections, contextText, contextMarkdown, feedLines, eggLines } from "../lib/vision-context-rules.mjs";
import { penReportFormatted, pensFormatted } from "../lib/oriya-pen-report-format.mjs";

const raw = [
  { key: "TIME", lines: ["local time at the farm Sat 14:05"] },
  { key: "FLOCK", lines: ["Batch 7: broilers, about 24 days old"] },
  { key: "FEED", lines: ["80 kg in the last 24 hours (about 95 g per bird)"] },
  { key: "WATER", lines: [] },
  { key: "PEN", lines: ["Pen 1: 10 × 12 m (120 m²)"] },
  { key: "HEALTH", lines: ["open case: coughing (moderate, since 2026-11-25)"] },
];

test("the facts that matter for the kind of check come first, and empty ones are dropped", () => {
  assert.deepEqual(orderSections(raw, "FEED").map((s) => s.key), ["FEED", "FLOCK", "PEN", "TIME", "HEALTH"]);
  assert.deepEqual(orderSections(raw, "BIRD").map((s) => s.key).slice(0, 2), ["HEALTH", "FLOCK"]);
  assert.deepEqual(orderSections(raw, "OTHER").map((s) => s.key), ["TIME", "FLOCK", "FEED", "HEALTH", "PEN"]);
  assert.equal(orderSections(raw, "FEED")[0].title, "Feed");
});

test("one paragraph for the model, and bold headings with bullets for people", () => {
  const s = orderSections(raw, "PEN");
  assert.match(contextText(s), /^Pen: Pen 1: 10 × 12 m \(120 m²\)\. /);
  const md = contextMarkdown("Pen report: Pen 1", s, "Check in person.");
  assert.match(md, /^\*\*Pen report: Pen 1\*\*\n\n\*\*Pen\*\*\n- Pen 1: 10 × 12 m/);
  assert.match(md, /\*\*Health and treatments\*\*\n- open case: coughing/);
  assert.match(md, /\n\n_Check in person\._$/);
});

test("feed per bird and egg laying rate from the records", () => {
  assert.deepEqual(feedLines({ kg24h: 80, kg7d: 520.44, live: 842 }), ["80 kg in the last 24 hours (about 95 g per bird)", "520.4 kg in the last 7 days"]);
  assert.deepEqual(feedLines({ kg24h: 0, kg7d: 0, live: 100 }), ["no feed recorded in the last 7 days"]);
  assert.deepEqual(eggLines({ total: 850, floor: 17, cracked: 4, hens: 1000 }), ["850 eggs in the last 24 hours (85% laying)", "17 floor eggs (2%)", "4 cracked"]);
  assert.deepEqual(eggLines({ total: 0, floor: 0, cracked: 0, hens: 1000 }), ["no eggs recorded in the last 24 hours"]);
});

test("the Operator Mode pen report: status line, latest check, findings, records, earlier checks, formatted", () => {
  const r = penReportFormatted({
    pen: "Pen 1",
    inspections: [
      { observedAt: "2026-11-27T14:00:00.000Z", status: "WARNING", summary: "Wet litter under the drinker line.", checks: ["Check the drinker line for leaks"] },
      { observedAt: "2026-11-27T08:00:00.000Z", status: "GOOD", summary: "Birds spread evenly." },
    ],
    findings: [{ title: "Wet litter", severity: "HIGH", state: "OBSERVED", occurrences: 2, lastSeenAt: "2026-11-27T14:00:00.000Z" }],
    sections: orderSections(raw, "PEN"),
    now: "2026-11-27T14:05:00.000Z",
  });
  assert.equal(r.title, "Pen report: Pen 1");
  assert.equal(r.status, "Needs attention (latest check 2026-11-27 14:00)");
  assert.deepEqual(r.sections.map((s) => s.key), ["LATEST", "FINDINGS", "PEN", "FLOCK", "FEED", "HEALTH", "EARLIER"]);
  assert.match(r.markdown, /^\*\*Pen report: Pen 1\*\*\n\n\*\*Status\*\*\n- Needs attention/);
  assert.match(r.markdown, /\*\*Latest Vision check\*\*\n- Wet litter under the drinker line\.\n- To check: Check the drinker line for leaks/);
  assert.match(r.markdown, /\*\*Open findings\*\*\n- Wet litter: high, seen 2 times/);
  assert.match(r.markdown, /\*\*Earlier checks\*\*\n- 2026-11-27 08:00: Looks good in the latest picture\. Birds spread evenly\./);
  assert.match(r.markdown, /_From Flockence records and Farm Vision\./);
  assert.ok(!r.sections.some((s) => s.key === "TIME"), "the time line is left out of the report");

  const none = penReportFormatted({ pen: "Pen 2", inspections: [], findings: [], sections: [], now: "x" });
  assert.equal(none.status, "No Vision check of this pen yet");
  assert.match(none.markdown, /\*\*Open findings\*\*\n- none open/);
});

test("the list of pens for Operator Mode", () => {
  const p = pensFormatted([{ name: "Pen 1" }, { name: "Brooder" }], true);
  assert.match(p.markdown, /\*\*Pens\*\*\n- Pen 1\n- Brooder\n- and more: ask for a pen by name/);
});
