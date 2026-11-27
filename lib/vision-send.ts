// Runs in the browser. Sends a Farm Vision check so that a weak signal, a dropped connection or leaving the page never
// loses it or charges it twice, and keeps photos taken with no signal on this device until they can be sent.
import { retryDelayMs } from "@/lib/photo-size.mjs";

export type SendResult = { httpStatus: number; body: Record<string, unknown> };
export class OfflineError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A random id for one check; the same id is used for every retry, so the server runs it once. */
export function uploadId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** POST once, retrying a lost connection (or a gateway error) after 2, 5 and 10 seconds with the same id. */
async function post(form: FormData, id: string, onProgress: (text: string) => void): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("/api/vision", { method: "POST", body: form, headers: { "Idempotency-Key": id, Prefer: "respond-async" } });
      if (response.status !== 502 && response.status !== 504) return response;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    const wait = retryDelayMs(attempt + 1);
    if (wait === null) throw new OfflineError("No connection.");
    onProgress("Connection lost. Trying again…");
    await sleep(wait);
  }
}

/**
 * Send a check and wait for its result. The server answers at once and analyses in the background; this asks for the
 * result every few seconds. Throws OfflineError when the photo could not be sent at all.
 */
export async function sendInspection(form: FormData, id: string, onProgress: (text: string) => void = () => {}): Promise<SendResult> {
  let response = await post(form, id, onProgress);
  if (response.status !== 202) return { httpStatus: response.status, body: await response.json().catch(() => ({ error: "Could not analyze photo." })) };
  onProgress("Photo received. Checking it now; you can leave this page and find the result in the history.");
  const deadline = Date.now() + 5 * 60_000;
  let resent = false;
  for (let wait = 2000; Date.now() < deadline; wait = Math.min(wait + 1000, 5000)) {
    await sleep(wait);
    let status: { state?: string; httpStatus?: number; result?: Record<string, unknown> } | null = null;
    try {
      const r = await fetch(`/api/vision/status?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.ok) status = await r.json();
    } catch { /* the signal dropped; keep asking */ }
    if (status?.state === "DONE" && status.result) return { httpStatus: status.httpStatus ?? 200, body: status.result };
    if (status?.state === "UNKNOWN" && !resent) {
      // The server lost the check (for example a restart). Nothing was saved or charged; send it again, same id.
      resent = true;
      response = await post(form, id, onProgress);
      if (response.status !== 202) return { httpStatus: response.status, body: await response.json().catch(() => ({ error: "Could not analyze photo." })) };
    }
  }
  return { httpStatus: 202, body: { pending: true } };
}

// ---- Photos kept on this device while there is no signal ----

export type QueuedCheck = {
  id: string; userId: string; farmId: string; createdAt: number;
  fields: Record<string, string>; image: Blob; imageName: string;
};
const DB = "flockence-vision-queue";
const STORE = "checks";
const KEEP_DAYS = 7;

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function queueOp<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openQueue();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function queueAvailable() {
  return typeof indexedDB !== "undefined";
}

export async function queueCheck(check: QueuedCheck) {
  await queueOp("readwrite", (s) => s.put(check));
}

/** This user's queued checks on this farm, oldest first. Checks older than a week are dropped. */
export async function queuedChecks(userId: string, farmId: string): Promise<QueuedCheck[]> {
  if (!queueAvailable()) return [];
  const all = await queueOp<QueuedCheck[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedCheck[]>).catch(() => []);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const old of all.filter((c) => c.createdAt < cutoff)) await queueOp("readwrite", (s) => s.delete(old.id)).catch(() => undefined);
  return all.filter((c) => c.createdAt >= cutoff && c.userId === userId && c.farmId === farmId).sort((a, b) => a.createdAt - b.createdAt);
}

export function formFromQueued(check: QueuedCheck) {
  const form = new FormData();
  form.append("image", new File([check.image], check.imageName, { type: check.image.type || "image/jpeg" }));
  for (const [k, v] of Object.entries(check.fields)) form.append(k, v);
  return form;
}

/**
 * Send this user's queued checks, oldest first. A check leaves the queue once the server has it (done, still being
 * checked, or refused for good, for example the plan's monthly limit). Stops at the first one that cannot be sent.
 */
export async function sendQueued(userId: string, farmId: string, onProgress: (text: string) => void = () => {}) {
  let sent = 0, failed = 0;
  for (const check of await queuedChecks(userId, farmId)) {
    let result: SendResult;
    try {
      result = await sendInspection(formFromQueued(check), check.id, onProgress);
    } catch (error) {
      if (error instanceof OfflineError) break;
      throw error;
    }
    // Signed out, rate-limited, still running after 5 minutes, or a server problem: keep it and try again later.
    if (result.httpStatus === 401 || result.httpStatus === 429 || result.httpStatus === 202 || result.httpStatus >= 500) break;
    await queueOp("readwrite", (s) => s.delete(check.id)).catch(() => undefined);
    if (result.httpStatus < 300) sent += 1; else failed += 1;
  }
  return { sent, failed, left: (await queuedChecks(userId, farmId)).length };
}
