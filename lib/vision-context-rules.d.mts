export type ContextSection = { key: string; title: string; lines: string[] };
export const SECTION_TITLES: Record<string, string>;
export function orderSections(sections: { key: string; title?: string; lines: string[] }[], category?: string): ContextSection[];
export function contextText(sections: ContextSection[]): string;
export function contextMarkdown(heading: string, sections: ContextSection[], footer?: string): string;
export function feedLines(input: { kg24h: number; kg7d: number; live: number }): string[];
export function eggLines(input: { total: number; floor: number; cracked: number; hens: number }): string[];
