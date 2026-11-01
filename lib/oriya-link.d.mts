export declare const MAX_AGE_SECONDS: number;
export declare const MAX_FRAMES: number;
export declare const MAX_FRAME_BYTES: number;
export interface OriyaLinkConfig { baseUrl: string; keyId: string; secret: string }
export type FrameMime = "image/jpeg" | "image/png" | "image/webp";
export interface OriyaFrame { mimeType: FrameMime; imageBase64: string; secondsAfterFirst: number }
export interface FrameRequest { requestId: string; camera: string; frames: number; secondsApart: number }
export type DeathCause = "UNKNOWN" | "HEAT" | "DISEASE" | "INJURY" | "PREDATOR" | "CULLED" | "OTHER";
export declare function oriyaLinkConfig(env: Record<string, string | undefined>): OriyaLinkConfig | null;
export declare function signOriyaBody(secret: string, timestamp: number, rawBody: string | Buffer): string;
export declare function verifyOriyaSignature(secret: string, timestampHeader: string | null, signatureHeader: string | null, rawBody: string | Buffer, nowMs?: number):
  { ok: true; timestamp: number } | { ok: false; reason: "TOO_OLD" | "BAD_SIGNATURE" };
export declare function allowedCameras(env: Record<string, string | undefined>): Map<string, string>;
export declare function readFrameRequest(body: unknown): FrameRequest | null;
export declare function imageKind(bytes: Buffer): FrameMime | null;
export declare function frameFromBytes(bytes: Buffer, secondsAfterFirst: number): OriyaFrame | null;
export declare function buildFlockCheck(input: {
  eventId: string; occurredAt: string; house: string; deathsSince: string; deaths: number; causes?: Partial<Record<DeathCause, number>>;
  feedStockKg?: number; feedUsedKg24h?: number; alive?: number; ageDays?: number; temperatureC?: number; openHealthCases?: number;
}): Record<string, unknown>;
export declare function deathCause(reason: string | null | undefined): DeathCause;
