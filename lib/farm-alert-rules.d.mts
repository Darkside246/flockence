export type AlertItem = { id: string; tone: "info" | "attention" | "urgent"; text: string; action?: { label: string; href: string }; basis?: string };
export type FarmAlertState = { date: string; sent: Record<string, string>; lastEmailAt: string | null };
export const QUIET_FROM: number;
export const QUIET_TO: number;
export const LATE_DAY_FROM: number;
export const MIN_GAP_MS: number;
export function alertable(item: AlertItem, hour: number): boolean;
export function isQuiet(hour: number): boolean;
export function planFarmAlerts(items: AlertItem[], state: FarmAlertState | null, local: { date: string; hour: number }, nowMs: number):
  { send: false; state: FarmAlertState } | { send: true; items: (AlertItem & { fresh: boolean })[]; state: FarmAlertState };
export function farmAlertEmail(items: (AlertItem & { fresh: boolean })[], farmName: string, link: string, base: string): { subject: string; text: string; html: string };
