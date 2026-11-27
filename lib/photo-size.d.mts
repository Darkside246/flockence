export const MAX_EDGE: number;
export const KEEP_BYTES: number;
export const JPEG_QUALITY: number;
export function targetSize(width: number, height: number, bytes: number, maxEdge?: number): { width: number; height: number } | null;
export function retryDelayMs(attempt: number): number | null;
export function validRequestId(value: unknown): value is string;
