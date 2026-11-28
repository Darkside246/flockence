export const AUTH_API: string;
export const WYZE_API: string;
export const APP_VERSION: string;
export const PENDING_MINUTES: number;
export function hashPassword(password: string): string;
export function newPhoneId(): string;
export function loginHeaders(keyId: string, apiKey: string): Record<string, string>;
export function authAppHeaders(): Record<string, string>;
export function appHeaders(): Record<string, string>;
export function appPayload(accessToken: string, phoneId: string, now?: number): Record<string, unknown>;
export function readWyzeAnswer(json: unknown): { ok: true; data: any } | { ok: false; expired: boolean; message: string };
export type LoginStep =
  | { step: "done"; accessToken: string; refreshToken: string; userId: string }
  | { step: "totp"; verificationId: string; userId: string }
  | { step: "sms"; smsSessionId: string; userId: string }
  | { step: "refused"; message: string };
export function readLogin(data: unknown): LoginStep;
export type WyzeCloudCamera = { mac: string; name: string; model: string; thumbnail: string | null; thumbnailAt: string | null };
export function readCameraList(data: unknown): WyzeCloudCamera[];
export function safeThumbnailUrl(value: unknown): string | null;
export function wyzeDeviceKey(mac: string): string;
export function uniqueNames<T extends { name: string }>(cameras: T[], taken: Iterable<string>): T[];
export function seal(value: unknown, authSecret: string): string;
export function unseal(sealed: string, authSecret: string): any;
export function validCode(code: unknown): code is string;
export function freshEnough(takenAt: string | null | undefined, now?: number, maxMinutes?: number): boolean;
