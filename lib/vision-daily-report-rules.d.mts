export type DailySettings = { enabled: boolean; hour: number };
export type DailyState = { date: string; sentTo: string[]; done: boolean; skipped?: string };
export type DailyUser = { id: string; email: string; role: string; wantsReports: boolean };
export const DEFAULT_SETTINGS: DailySettings;
export function parseSettings(value: string | null | undefined): DailySettings;
export function isDue(settings: DailySettings, local: { date: string; hour: number }, state: DailyState | null): boolean;
export function recipientsToSend<T extends DailyUser>(users: T[], state: DailyState | null, today: string): T[];
export function worthSending(report: { coverage: { inspections: number }; actions: unknown[] }): boolean;
export function dailyEmail(report: unknown, farmName: string, dateLabel: string, link: string): { subject: string; text: string; html: string };
