import type { ContextSection } from "./vision-context-rules.mjs";
export type Formatted = { title: string; status?: string; sections: ContextSection[]; markdown: string; generatedAt?: string };
export function penReportFormatted(input: {
  pen: string;
  inspections: { observedAt: string; status: string; summary: string; checks?: string[] }[];
  findings: { title: string; severity: string; state: string; occurrences: number; lastSeenAt: string }[];
  sections: ContextSection[];
  now: string;
}): Formatted;
export function pensFormatted(pens: { name: string }[], more: boolean): Formatted;
