import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";

/**
 * Retry-safe, background Farm Vision uploads (2026-11-27).
 *
 * The phone sends a random id with each inspection (Idempotency-Key header), and the same id again when it retries
 * after a lost connection or sends a photo it queued while offline. Then:
 *  - while the first attempt is running, a retry shares it instead of analysing again;
 *  - once it has finished, the reply is kept for an hour, and a saved inspection is also found by the id stored with it.
 * So a picture is analysed, saved and counted against the plan only once.
 *
 * With "Prefer: respond-async" the server answers at once (202) and the phone asks for the result with
 * GET /api/vision/status?id=…, so a weak signal or leaving the page never loses the check.
 * Running and finished attempts are kept in this server process (Flockence runs as one service). If the service
 * restarts mid-check, the status is "unknown" and the phone sends the photo again with the same id; nothing was saved.
 */
export type UploadReply = { status: number; body: Record<string, unknown> };
export type UploadStatus = { state: "RUNNING" } | { state: "DONE"; reply: UploadReply } | { state: "UNKNOWN" };

const KEEP_MS = 60 * 60 * 1000;
const running = new Map<string, Promise<UploadReply>>();
const finished = new Map<string, { at: number; reply: UploadReply }>();

const key = (requestId: string) => `${currentFarmId()}:${requestId}`;

function sweep(now = Date.now()) {
  for (const [k, v] of finished) if (now - v.at > KEEP_MS) finished.delete(k);
}

/** The saved inspection for this id, as a reply (the summary of what was shown the first time). */
async function savedReply(requestId: string): Promise<UploadReply | null> {
  const saved = await prisma.healthObservation.findFirst({
    where: { farmId: currentFarmId(), category: { startsWith: "VISION:" }, visionAssessment: { path: ["requestId"], equals: requestId } },
    orderBy: { observedAt: "desc" },
  });
  if (!saved) return null;
  const assessment = (saved.visionAssessment ?? {}) as { summary?: string; confidence?: string | null; checks?: string[] };
  return {
    status: 200,
    body: {
      observation: saved, imageUrl: saved.imageUrl, repeated: true,
      analysis: { summary: assessment.summary, confidence: assessment.confidence ?? undefined, checks: assessment.checks ?? [], severity: saved.severity },
    },
  };
}

/** The reply to repeat for a retry (waiting for a running attempt), or null when this id has not been seen. */
export async function earlierReply(requestId: string): Promise<UploadReply | null> {
  sweep();
  const inFlight = running.get(key(requestId));
  if (inFlight) { const reply = await inFlight; return { status: reply.status, body: { ...reply.body, repeated: true } }; }
  const done = finished.get(key(requestId));
  if (done && done.reply.status < 300) return { status: done.reply.status, body: { ...done.reply.body, repeated: true } };
  return savedReply(requestId);
}

/** Where a check is, without waiting for it. */
export async function uploadStatus(requestId: string): Promise<UploadStatus> {
  sweep();
  if (running.has(key(requestId))) return { state: "RUNNING" };
  const done = finished.get(key(requestId));
  if (done) return { state: "DONE", reply: done.reply };
  const saved = await savedReply(requestId);
  return saved ? { state: "DONE", reply: saved } : { state: "UNKNOWN" };
}

/**
 * Run an upload once for its id; a retry arriving meanwhile shares the same result. The finished reply is kept for an
 * hour. A failed attempt (an error reply) can be tried again with the same id; only a saved inspection is final.
 */
export function runOnce(requestId: string, work: () => Promise<UploadReply>): Promise<UploadReply> {
  const k = key(requestId);
  const existing = running.get(k);
  if (existing) return existing;
  finished.delete(k);
  const promise = work()
    .catch((): UploadReply => ({ status: 500, body: { error: "Could not analyze image." } }))
    .then((reply) => { finished.set(k, { at: Date.now(), reply }); return reply; })
    .finally(() => running.delete(k));
  running.set(k, promise);
  return promise;
}
