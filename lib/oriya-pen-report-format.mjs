// The pen report Oriya's Operator Mode asks for (app/api/integrations/oriya/pen-report), laid out for people: a title,
// a one-line status, then sections with bold headings and bullet points. Returned as both structured sections (for
// Oriya to lay out itself) and ready-made Markdown (bold, lists), which also reads well as plain WhatsApp text.
// Pure, so it can be tested. Only facts from the farm's records and saved inspections; nothing is generated here.

import { contextMarkdown } from "./vision-context-rules.mjs";

const STATUS = {
  CRITICAL: "Urgent: check in person now", WARNING: "Needs attention", ATTENTION: "Needs attention",
  INSUFFICIENT_EVIDENCE: "Not enough seen to judge", GOOD: "Looks good in the latest picture",
};
const SEVERITY = { CRITICAL: "urgent", HIGH: "high", MEDIUM: "medium", INFO: "low" };
const day = (iso) => String(iso).slice(0, 16).replace("T", " ");

/** pen, inspections (newest first), open findings, farm-record sections (lib/vision-context.ts), now (ISO). */
export function penReportFormatted({ pen, inspections, findings, sections, now }) {
  const latest = inspections[0];
  const headline = latest ? `${STATUS[latest.status] ?? latest.status} (latest check ${day(latest.observedAt)})` : "No Vision check of this pen yet";
  const out = [];
  if (latest) out.push({ key: "LATEST", title: "Latest Vision check", lines: [latest.summary, ...(latest.checks ?? []).map((c) => `To check: ${c}`)] });
  out.push({
    key: "FINDINGS", title: "Open findings",
    lines: findings.length ? findings.map((f) => `${f.title}: ${SEVERITY[f.severity] ?? f.severity}${f.occurrences > 1 ? `, seen ${f.occurrences} times` : ""}${f.state === "CONFIRMED" ? ", confirmed by the farm" : ""} (last ${day(f.lastSeenAt)})`) : ["none open"],
  });
  for (const s of sections) if (s.key !== "TIME" && s.key !== "FINDINGS") out.push({ key: s.key, title: s.title, lines: s.lines });
  if (inspections.length > 1) out.push({ key: "EARLIER", title: "Earlier checks", lines: inspections.slice(1).map((i) => `${day(i.observedAt)}: ${STATUS[i.status] ?? i.status}. ${i.summary}`) });
  const footer = "From Flockence records and Farm Vision. Vision can be wrong and never changes the records; please check in person.";
  return {
    title: `Pen report: ${pen}`,
    status: headline,
    sections: out,
    markdown: contextMarkdown(`Pen report: ${pen}`, [{ key: "STATUS", title: "Status", lines: [headline] }, ...out], footer),
    generatedAt: now,
  };
}

/** The list of pens, when Operator Mode asks which pens there are. */
export function pensFormatted(pens, more) {
  const lines = pens.map((p) => p.name).concat(more ? ["and more: ask for a pen by name"] : []);
  return {
    title: "Pens on this farm",
    sections: [{ key: "PENS", title: "Pens", lines: lines.length ? lines : ["no pens recorded yet"] }],
    markdown: contextMarkdown("Pens on this farm", [{ key: "PENS", title: "Pens", lines: lines.length ? lines : ["no pens recorded yet"] }], "Ask for one by name, for example \"Check Pen 1\"."),
  };
}
