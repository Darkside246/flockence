import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { currentFarmId } from "@/lib/farm-scope";

const PREFIX = "CAMERA_GATEWAY::";
export const MAX_FRAME_BYTES = 256 * 1024;
export const gatewayIdPattern = /^[a-f0-9]{32}$/;
const farmPattern = /^[A-Za-z0-9_-]{3,64}$/;
const tokenPattern = /^cg1\.([A-Za-z0-9_-]{3,64})\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}$/;

export type GatewayBrand = "wyze" | "network";
type Gateway = { name: string; brand: GatewayBrand; tokenHash: string; frame?: { time: string; sealed: string } };
type GatewayRow = { id: string; key: string; value: string };

let gatewayDb: PrismaClient | undefined;

function frameKey() {
  const raw = process.env.CAMERA_GATEWAY_KEY ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64url");
  return key.length === 32 && key.toString("base64url") === raw ? key : null;
}

export function gatewayEnabled() {
  return Boolean(process.env.CAMERA_GATEWAY_DATABASE_URL && frameKey());
}

// All new gateway records go through a separate restricted pool. The farm
// binding lives only for this transaction, including on pooled connections.
async function withGateway<T>(work: (tx: Prisma.TransactionClient, farmId: string) => Promise<T>) {
  const farmId = currentFarmId();
  const url = process.env.CAMERA_GATEWAY_DATABASE_URL;
  if (!url || !gatewayEnabled() || !farmPattern.test(farmId)) throw new Error("CAMERA_GATEWAY_UNAVAILABLE");
  gatewayDb ??= new PrismaClient({ datasourceUrl: url });
  return gatewayDb.$transaction(async (tx) => {
    const [scope] = await tx.$queryRaw<{ farm: string; role: string; protected: boolean; policy: boolean }[]>`
      SELECT set_config('app.farm_id', ${farmId}, true) AS farm,
             current_user::text AS role,
             row_security_active('public."Setting"') AS protected,
             EXISTS (
               SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Setting'
                 AND policyname = 'flockence_gateway_boundary' AND permissive = 'RESTRICTIVE'
                 AND 'flockence_camera_gateway' = ANY(roles)
             ) AS policy
    `;
    if (scope?.farm !== farmId || scope.role !== "flockence_camera_gateway" || !scope.protected || !scope.policy) {
      throw new Error("CAMERA_GATEWAY_RLS_REQUIRED");
    }
    return work(tx, farmId);
  });
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const keyFor = (id: string) => PREFIX + id;
const read = (row: GatewayRow | null): Gateway | null => row ? JSON.parse(row.value) as Gateway : null;

export function parseGatewayToken(header: string | null, id: string) {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const match = tokenPattern.exec(token);
  return match && match[2] === id ? { farmId: match[1], token } : null;
}

function publicFeed(row: GatewayRow) {
  const entry = read(row)!;
  return { id: row.key.slice(PREFIX.length), name: entry.name, brand: entry.brand, capturedAt: entry.frame?.time ?? null };
}

export function listGateways() {
  return withGateway(async (tx, farmId) => {
    const rows = await tx.setting.findMany({
      where: { farmId, key: { startsWith: PREFIX } },
      select: { id: true, key: true, value: true },
      orderBy: { key: "asc" }, take: 6,
    });
    return rows.map(publicFeed);
  });
}

export function createGateway(name: string, brand: GatewayBrand) {
  return withGateway(async (tx, farmId) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8194))::text`;
    if (await tx.setting.count({ where: { farmId, key: { startsWith: PREFIX } } }) >= 6) return null;

    const id = randomUUID().replaceAll("-", "");
    const token = "cg1." + farmId + "." + id + "." + randomBytes(32).toString("base64url");
    const data: Gateway = { name, brand, tokenHash: hash(token) };
    const row = await tx.setting.create({ data: { farmId, key: keyFor(id), value: JSON.stringify(data) } });
    return { ...publicFeed(row), token };
  });
}

export function removeGateway(id: string) {
  return withGateway((tx, farmId) => tx.setting.deleteMany({ where: { farmId, key: keyFor(id) } }));
}

export function gatewayUploadAllowed(id: string, token: string) {
  return withGateway(async (tx, farmId) => {
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: keyFor(id) } } });
    return authorized(read(row), token);
  });
}

function authorized(entry: Gateway | null, token: string): entry is Gateway {
  return Boolean(entry && /^[a-f0-9]{64}$/.test(entry.tokenHash)
    && timingSafeEqual(Buffer.from(entry.tokenHash, "hex"), Buffer.from(hash(token), "hex")));
}

const aad = (farmId: string, id: string, time: string) => Buffer.from("flockence-gateway:v1:" + farmId + ":" + id + ":" + time);

export function saveGatewayFrame(id: string, token: string, time: string, bytes: Uint8Array) {
  return withGateway(async (tx, farmId) => {
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: keyFor(id) } } });
    const entry = read(row);
    if (!row || !authorized(entry, token)) return "unauthorized";
    if (entry.frame && entry.frame.time >= time) return "stale";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", frameKey()!, iv);
    cipher.setAAD(aad(farmId, id, time));
    const sealed = Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString("base64");
    const value = JSON.stringify({ ...entry, frame: { time, sealed } });
    const update = await tx.setting.updateMany({ where: { id: row.id, farmId, value: row.value }, data: { value } });
    return update.count === 1 ? "saved" : "stale";
  });
}

export function getGatewayFrame(id: string) {
  return withGateway(async (tx, farmId) => {
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: keyFor(id) } } });
    const frame = read(row)?.frame;
    if (!frame) return null;
    const sealed = Buffer.from(frame.sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", frameKey()!, sealed.subarray(0, 12));
    decipher.setAAD(aad(farmId, id, frame.time));
    decipher.setAuthTag(sealed.subarray(-16));
    return Uint8Array.from(Buffer.concat([decipher.update(sealed.subarray(12, -16)), decipher.final()]));
  });
}
