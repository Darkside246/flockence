import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import { boundedBody } from "@/lib/camera-gateway-http";
import {
  freshEnough, AUTH_API, WYZE_API, PENDING_MINUTES, appHeaders, appPayload, authAppHeaders, hashPassword, loginHeaders, newPhoneId,
  readCameraList, readLogin, readWyzeAnswer, safeThumbnailUrl, seal, unseal, uniqueNames, wyzeDeviceKey, type WyzeCloudCamera,
} from "@/lib/wyze-cloud-rules.mjs";

/**
 * Wyze cloud connection for one farm (lib/wyze-cloud-rules.mjs has the request shapes). The owner signs in with the Wyze
 * email and password and, if Wyze asks, the code from their authenticator app or text message, the same steps as the
 * Wyze app. Wyze also needs an API Key ID and key: the server's own (WYZE_API_KEY_ID / WYZE_API_KEY, set once by the
 * administrator) when present, otherwise the farm's own. Only the resulting tokens are kept, encrypted with a key
 * derived from AUTH_SECRET. The password is never stored; during a two-factor step its Wyze hash waits, encrypted, for
 * at most ten minutes.
 */
const CONNECTION = "WYZE_CLOUD_V1";
const PENDING = "WYZE_CLOUD_PENDING_V1";
const timeout = (ms: number) => AbortSignal.timeout(ms);

type Connection = { email: string; userId: string; phoneId: string; accessToken: string; refreshToken: string; connectedAt: string; keySource: "server" | "farm" };
type Pending = { email: string; passwordHash: string; keyId: string; apiKey: string; keySource: "server" | "farm"; phoneId: string; step: "totp" | "sms"; verificationId: string; userId: string; expiresAt: number };

export const wyzeCloudEnabled = () => process.env.FLOCKENCE_WYZE_CLOUD === "on";
export const serverWyzeKey = () => {
  const keyId = process.env.WYZE_API_KEY_ID?.trim(), apiKey = process.env.WYZE_API_KEY?.trim();
  return keyId && apiKey ? { keyId, apiKey } : null;
};
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is not set");
  return s;
}

async function readSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId: currentFarmId(), key } }, select: { value: true } });
  return row ? (unseal(row.value, secret()) as T | null) : null;
}
async function writeSetting(key: string, value: unknown) {
  const farmId = currentFarmId(), sealed = seal(value, secret());
  await prisma.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value: sealed }, update: { value: sealed } });
}
const dropSetting = (key: string) => prisma.setting.deleteMany({ where: { farmId: currentFarmId(), key } });

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: timeout(20_000) });
  const raw = await boundedBody(response, 2 * 1024 * 1024);
  if (!raw) throw new Error("Wyze sent an answer that was too large.");
  let json: unknown = null;
  try { json = JSON.parse(raw.toString("utf8")); } catch { throw new Error(response.ok ? "Wyze sent an answer Flockence could not read." : `Wyze answered ${response.status}.`); }
  return readWyzeAnswer(json);
}

export type SignInResult = { connected: true; email: string } | { needsCode: "totp" | "sms" } | { error: string; needsOwnKey?: boolean };

async function finishLogin(email: string, phoneId: string, keySource: "server" | "farm", data: { accessToken: string; refreshToken: string; userId: string }): Promise<SignInResult> {
  await writeSetting(CONNECTION, { email, userId: data.userId, phoneId, accessToken: data.accessToken, refreshToken: data.refreshToken, connectedAt: new Date().toISOString(), keySource } satisfies Connection);
  await dropSetting(PENDING);
  return { connected: true, email };
}

/** Step one: email and password (and the farm's own key when the server has none, or Wyze refused the server's). */
export async function startWyzeSignIn(input: { email: string; password: string; keyId?: string; apiKey?: string }): Promise<SignInResult> {
  const own = input.keyId && input.apiKey ? { keyId: input.keyId.trim(), apiKey: input.apiKey.trim() } : null;
  const key = own ?? serverWyzeKey();
  if (!key) return { error: "Add your Wyze API Key ID and API key below.", needsOwnKey: true };
  const keySource = own ? "farm" : "server";
  const email = input.email.trim().toLowerCase(), passwordHash = hashPassword(input.password), phoneId = newPhoneId();
  const answer = await post(`${AUTH_API}/api/user/login`, loginHeaders(key.keyId, key.apiKey), { email, password: passwordHash });
  if (!answer.ok) return { error: answer.message, needsOwnKey: keySource === "server" && /api key/i.test(answer.message) };
  const step = readLogin(answer.data);
  if (step.step === "done") return finishLogin(email, phoneId, keySource, step);
  if (step.step === "refused") return { error: step.message };
  let verificationId = step.step === "totp" ? step.verificationId : "";
  if (step.step === "sms") {
    const query = new URLSearchParams({ mfaPhoneType: "Primary", sessionId: step.smsSessionId, userId: step.userId });
    const sent = await post(`${AUTH_API}/user/login/sendSmsCode?${query}`, authAppHeaders(), {});
    if (!sent.ok || !sent.data?.session_id) return { error: sent.ok ? "Wyze could not send the text message code." : sent.message };
    verificationId = String(sent.data.session_id);
  }
  await writeSetting(PENDING, { email, passwordHash, ...key, keySource, phoneId, step: step.step, verificationId, userId: step.userId, expiresAt: Date.now() + PENDING_MINUTES * 60_000 } satisfies Pending);
  return { needsCode: step.step };
}

/** Step two, when Wyze asked for one: the code from the authenticator app or the text message. */
export async function finishWyzeSignIn(code: string): Promise<SignInResult> {
  const pending = await readSetting<Pending>(PENDING);
  if (!pending || pending.expiresAt < Date.now()) { await dropSetting(PENDING); return { error: "The sign-in took too long. Start again." }; }
  const answer = await post(`${AUTH_API}/user/login`, { ...authAppHeaders(), keyid: pending.keyId, apikey: pending.apiKey }, {
    email: pending.email, password: pending.passwordHash, mfa_type: pending.step === "totp" ? "TotpVerificationCode" : "PrimaryPhone",
    verification_id: pending.verificationId, verification_code: code.trim(),
  });
  if (!answer.ok) return { error: answer.message };
  const step = readLogin(answer.data);
  if (step.step !== "done") return { error: "Wyze did not accept that code. Try the newest one." };
  return finishLogin(pending.email, pending.phoneId, pending.keySource, { ...step, userId: step.userId || pending.userId });
}

export async function disconnectWyze() {
  await dropSetting(CONNECTION);
  await dropSetting(PENDING);
}

export async function wyzeCloudStatus() {
  const [connection, pending] = await Promise.all([readSetting<Connection>(CONNECTION), readSetting<Pending>(PENDING)]);
  return {
    enabled: wyzeCloudEnabled(), serverKey: Boolean(serverWyzeKey()),
    connected: Boolean(connection), email: connection?.email ?? null, connectedAt: connection?.connectedAt ?? null,
    waitingForCode: pending && pending.expiresAt > Date.now() ? pending.step : null,
  };
}

/** Swap an expired access token for a new one. Serialized per farm so two rounds never both refresh. */
async function refreshed(stale: Connection): Promise<Connection | null> {
  return prisma.$transaction(async (tx) => {
    const farmId = currentFarmId();
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId + ":" + CONNECTION}, 0))::text`;
    const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key: CONNECTION } }, select: { value: true } });
    const latest = row ? (unseal(row.value, secret()) as Connection | null) : null;
    if (!latest) return null;
    if (latest.accessToken !== stale.accessToken) return latest;
    const answer = await post(`${WYZE_API}/user/refresh_token`, appHeaders(), { ...appPayload(latest.accessToken, latest.phoneId), refresh_token: latest.refreshToken });
    if (!answer.ok || !answer.data?.access_token) return null;
    const next = { ...latest, accessToken: String(answer.data.access_token), refreshToken: String(answer.data.refresh_token || latest.refreshToken) };
    await tx.setting.update({ where: { farmId_key: { farmId, key: CONNECTION } }, data: { value: seal(next, secret()) } });
    return next;
  }, { timeout: 30_000 });
}

/** The farm's Wyze cameras with their latest cloud picture address; empty when not connected. */
export async function wyzeCloudCameras(): Promise<WyzeCloudCamera[]> {
  if (!wyzeCloudEnabled()) return [];
  let connection = await readSetting<Connection>(CONNECTION);
  if (!connection) return [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await post(`${WYZE_API}/v2/home_page/get_object_list`, appHeaders(), appPayload(connection.accessToken, connection.phoneId));
    if (answer.ok) return readCameraList(answer.data);
    if (!answer.expired) throw new Error(answer.message);
    connection = await refreshed(connection);
    if (!connection) throw new Error("The Wyze sign-in has expired. A farm owner signs in again under Settings → Camera connections → Wyze.");
  }
  return [];
}

/** Vision cameras for the Wyze cameras, named so no other camera on the farm shares the name. */
export async function wyzeVisionCameras(takenNames: string[]) {
  const cameras = uniqueNames(await wyzeCloudCameras(), takenNames);
  return cameras.map((c) => ({ name: c.name, source: "wyze" as const, deviceKey: wyzeDeviceKey(c.mac) }));
}

/**
 * The latest cloud picture of one Wyze camera, as a checked JPEG. Wyze only replaces it when the camera records an
 * event, so a picture older than WYZE_MAX_PICTURE_AGE_MINUTES (default 180), or one with no time, is skipped: checking
 * the same old picture twice would look like birds that have not moved.
 */
export async function wyzeCloudSnapshot(deviceKey: string, maxBytes: number, now = Date.now()) {
  const camera = (await wyzeCloudCameras()).find((c) => wyzeDeviceKey(c.mac) === deviceKey);
  const url = safeThumbnailUrl(camera?.thumbnail);
  if (!camera || !url || !freshEnough(camera.thumbnailAt, now)) return null;
  const response = await fetch(url, { redirect: "error", signal: timeout(20_000) });
  if (!response.ok) return null;
  const bytes = await boundedBody(response, maxBytes);
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return { bytes, takenAt: camera.thumbnailAt ? new Date(camera.thumbnailAt) : null };
}
