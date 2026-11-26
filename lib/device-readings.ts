import { z } from "zod";

const alias = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const deviceName = z.string().trim().regex(/^[^\p{C}]{1,48}$/u);
const base = { id: alias, name: deviceName };
const binary = z.enum(["on", "off"]).nullable();

const reading = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("temperature"), value: z.number().min(-80).max(150).nullable() }),
  z.strictObject({ ...base, kind: z.literal("humidity"), value: z.number().min(0).max(100).nullable() }),
  z.strictObject({ ...base, kind: z.literal("power"), value: z.number().min(0).max(1000000).nullable() }),
  z.strictObject({ ...base, kind: z.literal("switch"), value: binary }),
  z.strictObject({ ...base, kind: z.literal("door"), value: binary }),
  z.strictObject({ ...base, kind: z.literal("leak"), value: binary }),
]);

export const deviceReadings = z.array(reading).min(1).max(32)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length);
export type DeviceReading = z.infer<typeof reading>;

export const deviceGatewayId = /^[a-f0-9]{32}$/;
export const MAX_DEVICE_BODY = 12 * 1024;

export function validObservationTime(value: unknown, now = Date.now()): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= now - 600_000 && time <= now + 60_000 && new Date(time).toISOString() === value;
}
