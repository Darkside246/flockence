import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { currentFarmId } from "@/lib/farm-scope";

const PREFIX = "CAMERA_GATEWAY::";
export const MAX_FRAME_BYTES = 256 * 1024;
export const gatewayIdPattern = /^[a-f0-9]{32}$/;
const farmPattern = /^[A-Za-z0-9_-]{3,64}$/;
const BRIDGE_KEY = PREFIX + "WYZE_BRIDGE";
const bridgePattern = /^wb1\.([A-Za-z0-9_-]{3,64})\.[A-Za-z0-9_-]{43}$/;
const tokenPattern = /^cg1\.([A-Za-z0-9_-]{3,64})\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}$/;

export type GatewayBrand = "wyze" | "network";
type BridgeState = { tokenHash: string; lastSync?: string; seen?: number };
export type BridgeCamera = { device: string; name: string };
type Gateway = { name: string; brand: GatewayBrand; tokenHash?: string; bridgeDevice?: string; frame?: { time: string; sealed: string } };
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
  return match && match[2] === id ? { farmId: match[1], token } : parseWyzeBridgeToken(header);
}

export function parseWyzeBridgeToken(header: string | null) {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const match = bridgePattern.exec(token);
  return match ? { farmId: match[1], token } : null;
}

function publicFeed(row: GatewayRow) {
  const entry = read(row)!;
  return { id: row.key.slice(PREFIX.length), name: entry.name, brand: entry.brand, capturedAt: entry.frame?.time ?? null };
}

export function listGateways() {
  return withGateway(async (tx, farmId) => {
    const rows = await tx.setting.findMany({
      where: { farmId, key: { startsWith: PREFIX, not: BRIDGE_KEY } },
      select: { id: true, key: true, value: true },
      orderBy: { key: "asc" }, take: 6,
    });
    return rows.map(publicFeed);
  });
}

export function createGateway(name: string, brand: GatewayBrand) {
  return withGateway(async (tx, farmId) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8194))::text`;
    if (await tx.setting.count({ where: { farmId, key: { startsWith: PREFIX, not: BRIDGE_KEY } } }) >= 6) return null;

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
    return authorized(tx, farmId, read(row), token);
  });
}

function matches(stored: string | undefined, token: string) {
  return Boolean(stored && /^[a-f0-9]{64}$/.test(stored)
    && timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(hash(token), "hex")));
}

async function readBridge(tx: Prisma.TransactionClient, farmId: string) {
  const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: BRIDGE_KEY } } });
  return row ? JSON.parse(row.value) as BridgeState : null;
}

async function authorized(tx: Prisma.TransactionClient, farmId: string, entry: Gateway | null, token: string) {
  if (!entry) return false;
  if (!entry.bridgeDevice) return matches(entry.tokenHash, token);
  if (entry.brand !== "wyze" || !bridgePattern.test(token)) return false;
  const bridge = await readBridge(tx, farmId);
  return matches(bridge?.tokenHash, token);
}

export function wyzeBridgeStatus() {
  return withGateway(async (tx, farmId) => {
    const bridge = await readBridge(tx, farmId);
    return { linked: Boolean(bridge), lastSync: bridge?.lastSync ?? null, seen: bridge?.seen ?? 0 };
  });
}

export function createWyzeBridgeLink() {
  return withGateway(async (tx, farmId) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8194))::text`;
    const token = "wb1." + farmId + "." + randomBytes(32).toString("base64url");
    const value = JSON.stringify({ tokenHash: hash(token) } satisfies BridgeState);
    await tx.setting.upsert({
      where: { farmId_key: { farmId, key: BRIDGE_KEY } },
      create: { farmId, key: BRIDGE_KEY, value },
      update: { value },
    });
    return { token };
  });
}

export function revokeWyzeBridgeLink() {
  return withGateway(async (tx, farmId) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8194))::text`;
    await tx.setting.deleteMany({ where: { farmId, key: BRIDGE_KEY } });
  });
}

export function wyzeBridgeAllowed(token: string) {
  return withGateway(async (tx, farmId) => matches((await readBridge(tx, farmId))?.tokenHash, token));
}

export function syncWyzeBridge(token: string, cameras: BridgeCamera[]) {
  return withGateway(async (tx, farmId) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8194))::text`;
    const bridge = await readBridge(tx, farmId);
    if (!bridge || !matches(bridge.tokenHash, token)) return null;
    const rows = await tx.setting.findMany({
      where: { farmId, key: { startsWith: PREFIX, not: BRIDGE_KEY } },
      select: { id: true, key: true, value: true },
    });
    const existing = new Map(rows.flatMap(row => {
      const entry = read(row);
      return entry?.bridgeDevice ? [[entry.bridgeDevice, { row, entry }] as const] : [];
    }));
    const feeds = [];
    let count = rows.length;
    for (const camera of cameras) {
      const match = existing.get(camera.device);
      if (match) {
        if (match.entry.name !== camera.name) {
          await tx.setting.update({ where: { id: match.row.id }, data: { value: JSON.stringify({ ...match.entry, name: camera.name }) } });
        }
        feeds.push({ device: camera.device, id: match.row.key.slice(PREFIX.length) });
      } else if (count < 6) {
        const id = randomUUID().replaceAll("-", "");
        const feed: Gateway = { name: camera.name, brand: "wyze", bridgeDevice: camera.device };
        await tx.setting.create({ data: { farmId, key: keyFor(id), value: JSON.stringify(feed) } });
        feeds.push({ device: camera.device, id });
        count++;
      }
    }
    await tx.setting.update({
      where: { farmId_key: { farmId, key: BRIDGE_KEY } },
      data: { value: JSON.stringify({ ...bridge, lastSync: new Date().toISOString(), seen: cameras.length }) },
    });
    return { feeds, skipped: cameras.length - feeds.length };
  });
}

const aad = (farmId: string, id: string, time: string) => Buffer.from("flockence-gateway:v1:" + farmId + ":" + id + ":" + time);

export function saveGatewayFrame(id: string, token: string, time: string, bytes: Uint8Array) {
  return withGateway(async (tx, farmId) => {
    if (bridgePattern.test(token)) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 8194))::text`;
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: keyFor(id) } } });
    const entry = read(row);
    if (!row || !entry || !await authorized(tx, farmId, entry, token)) return "unauthorized";
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
