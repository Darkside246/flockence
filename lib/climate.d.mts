export interface ThermometerReadingInput { readAt: Date; temperatureC: number; humidityPct: number | null }
export interface OriyaClimateEntry {
  sensor: string; temperatureC: number; humidityPct?: number; readAt: string;
  hourAgo?: { temperatureC: number; minutesBefore: number };
}
export declare function parseOffset(text: string | null | undefined): number | null;
export declare function farmOffset(env: Record<string, string | undefined>): string;
export declare function isoWithOffset(date: Date, offset: string): string;
export declare function farmHour(date: Date, offset: string): number;
export declare function parseLocalTime(text: string, offset: string): Date | null;
export declare function parseThermometerCsv(text: string, offset: string):
  { readings: ThermometerReadingInput[]; skipped: number; error: null | "EMPTY" | "COLUMNS_NOT_FOUND" };
export declare function validSensorName(name: unknown): boolean;
export declare const SEND_WITHIN_MINUTES: number;
export declare function climateForOriya(readingsBySensor: Map<string, ThermometerReadingInput[]>, now: Date, offset: string): OriyaClimateEntry[];
export declare function liveViewInterval(hour: number): number;
export declare const NUMBERS_EVERY_MINUTES: number;
export declare const DEFAULT_DAILY_LIVE_VIEWS: number;
export declare function autoDecision(input: {
  hour: number; minutesSinceNumbers: number | null; minutesSinceLiveView: number | null; oriyaDueNow: boolean; liveViewsToday: number; dailyCap: number;
}): { numbers: boolean; pictures: "none" | "fresh"; capped: boolean };
export declare function referenceMinutes(savedAt: Date, now: Date): number | null;
