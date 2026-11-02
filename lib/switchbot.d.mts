export declare const SWITCHBOT_API: string;
export interface SwitchbotConfig { token: string; secret: string; thermometers: Map<string, string> }
export declare function switchbotConfig(env: Record<string, string | undefined>): SwitchbotConfig | null;
export declare function switchbotHeaders(token: string, secret: string, t?: number, nonce?: string): Record<string, string>;
export declare function readingFromStatus(json: unknown): { temperatureC: number; humidityPct: number | null } | null;
export declare function thermometersFromDeviceList(json: unknown): Array<{ deviceId: string; name: string; type: string }>;
export declare function readIntakeBody(body: unknown): Array<{ sensor: string; readAt: Date; temperatureC: number; humidityPct: number | null }> | null;
export declare const POLL_EVERY_MINUTES: number;
