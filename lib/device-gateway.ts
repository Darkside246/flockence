import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { currentFarmId } from "@/lib/farm-scope";
import { deviceReadings, type DeviceReading } from "@/lib/device-readings";
import { checkRateLimit } from "@/lib/rate-limit";

const PREFIX = "SMART_DEVICE_GATEWAY::";
const farmPattern = /^[A-Za-z0-9_-]{3,64}$/;
const tokenPattern = /^dg1\.([A-Za-z0-9_-]{3,64})\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}$/;
type Link = { name: string; hash: string; observedAt?: string; sealed?: string };
type Row = { key: string; value: string };
let client: PrismaClient | undefined;

function encryptionKey() {
  const raw = process.env.DEVICE_GATEWAY_KEY ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64url");
  return key.length === 32 && key.toString("base64url") === raw ? key : null;
}

export function deviceGatewayEnabled() {
  return Boolean(process.env.DEVICE_GATEWAY_DATABASE_URL && encryptionKey());
}

async function withDevices<T>(work: (tx: Prisma.TransactionClient, farmId: string) => Promise<T>) {
  const farmId = currentFarmId();
  const url = process.env.DEVICE_GATEWAY_DATABASE_URL;
  if (!url || !deviceGatewayEnabled() || !farmPattern.test(farmId)) throw new Error("DEVICE_GATEWAY_UNAVAILABLE");
  client ??= new PrismaClient({ datasourceUrl: url });
  return client.$transaction(async (tx) => {
    const [scope] = await tx.$queryRaw<{ farm: string; role: string; protected: boolean; policy: boolean }[]>`
      SELECT set_config('app.farm_id', ${farmId}, true) AS farm,
             current_user::text AS role,
             row_security_active('public."Setting"') AS protected,
             EXISTS (
               SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Setting'
                 AND policyname = 'flockence_device_gateway_boundary' AND permissive = 'RESTRICTIVE'
                 AND 'flockence_device_gateway' = ANY(roles)
             ) AS policy
    `;
    if (scope?.farm !== farmId || scope.role !== "flockence_device_gateway" || !scope.protected || !scope.policy) {
      throw new Error("DEVICE_RLS_REQUIRED");
    }
    return work(tx, farmId);
  });
}

const keyFor = (id: string) => PREFIX + id;
const digest = (token: string) => createHash("sha256").update(token).digest();
const metadata = (row: Row): Link => JSON.parse(row.value) as Link;
const aad = (farm: string, id: string, at: string) => Buffer.from("flockence-device:v1:" + farm + ":" + id + ":" + at);

export function parseDeviceToken(header: string | null, id: string) {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const match = tokenPattern.exec(token);
  return match && match[2] === id ? { farmId: match[1], token } : null;
}

function matches(link: Link, token: string) {
  return /^[a-f0-9]{64}$/.test(link.hash) && timingSafeEqual(Buffer.from(link.hash, "hex"), digest(token));
}

function readingsFor(link: Link, farmId: string, id: string): DeviceReading[] {
  if (!link.sealed || !link.observedAt) return [];
  const packed = Buffer.from(link.sealed, "base64");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey()!, packed.subarray(0, 12));
  cipher.setAAD(aad(farmId, id, link.observedAt));
  cipher.setAuthTag(packed.subarray(-16));
  const decoded = Buffer.concat([cipher.update(packed.subarray(12, -16)), cipher.final()]).toString("utf8");
  return deviceReadings.parse(JSON.parse(decoded));
}

export function listDeviceLinks() {
  return withDevices(async (tx, farmId) => {
    const rows = await tx.setting.findMany({ where: { farmId, key: { startsWith: PREFIX } }, orderBy: { key: "asc" }, take: 4 });
    return rows.map((row) => {
      const id = row.key.slice(PREFIX.length);
      const link = metadata(row);
      return { id, name: link.name, observedAt: link.observedAt ?? null, devices: readingsFor(link, farmId, id) };
    });
  });
}

export function createDeviceLink(name: string) {
  return withDevices(async (tx, farmId) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8195))::text`;
    if (await tx.setting.count({ where: { farmId, key: { startsWith: PREFIX } } }) >= 4) return null;
    const id = randomUUID().replaceAll("-", "");
    const token = "dg1." + farmId + "." + id + "." + randomBytes(32).toString("base64url");
    const link: Link = { name, hash: digest(token).toString("hex") };
    await tx.setting.create({ data: { farmId, key: keyFor(id), value: JSON.stringify(link) } });
    return { id, token };
  });
}

export function removeDeviceLink(id: string) {
  return withDevices((tx, farmId) => tx.setting.deleteMany({ where: { farmId, key: keyFor(id) } }));
}

export function deviceUploadAllowed(id: string, token: string) {
  return withDevices(async (tx, farmId) => {
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: keyFor(id) } } });
    return row !== null && matches(metadata(row), token);
  });
}

export function uploadDeviceState(id: string, token: string, observedAt: string, devices: DeviceReading[]) {
  return withDevices(async (tx, farmId) => {
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: keyFor(id) } } });
    if (!row) return "unauthorized";
    const link = metadata(row);
    if (!matches(link, token)) return "unauthorized";
    if (link.observedAt && link.observedAt >= observedAt) return "stale";
    const limit = await checkRateLimit("smart-device-upload:" + farmId + ":" + id, 8, 60_000);
    if (!limit.allowed) return "limited";

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey()!, iv);
    cipher.setAAD(aad(farmId, id, observedAt));
    const sealed = Buffer.concat([iv, cipher.update(JSON.stringify(devices), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
    const value = JSON.stringify({ ...link, observedAt, sealed });
    const changed = await tx.setting.updateMany({ where: { id: row.id, farmId, value: row.value }, data: { value } });
    return changed.count === 1 ? "saved" : "stale";
  });
}
