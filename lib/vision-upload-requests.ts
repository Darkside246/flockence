import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";

/**
 * Retry-safe Farm Vision uploads (2026-11-27). The phone sends a random id with each inspection
 * (Idempotency-Key header) and the same id again when it retries after a lost connection. Then:
 *  - while the first attempt is still running, the retry waits for it and gets the same answer;
 *  - once it has been saved, the retry gets the saved inspection back.
 * Either way the picture is analysed, saved and counted against the plan only once. The running attempts are kept in
 * this server process (Flockence runs as one service); saved ones are found by the id stored with the inspection.
 */
export type UploadReply = { status: number; body: Record<string, unknown> };

const running = new Map<string, Promise<UploadReply>>();

const key = (requestId: string) => `${currentFarmId()}:${requestId}`;

/** The reply to repeat for a retry, or null when this id has not been seen. */
export async function earlierReply(requestId: string): Promise<UploadReply | null> {
  const inFlight = running.get(key(requestId));
  if (inFlight) { const reply = await inFlight; return { status: reply.status, body: { ...reply.body, repeated: true } }; }
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
      // The full answer was shown on the first attempt; this is the saved summary of it.
      analysis: { summary: assessment.summary, confidence: assessment.confidence ?? undefined, checks: assessment.checks ?? [], severity: saved.severity },
    },
  };
}

/** Run an upload once for its id; a retry arriving meanwhile shares the same result. */
export async function runOnce(requestId: string, work: () => Promise<UploadReply>): Promise<UploadReply> {
  const k = key(requestId);
  const existing = running.get(k);
  if (existing) return existing;
  const promise = work();
  running.set(k, promise);
  try {
    return await promise;
  } finally {
    running.delete(k);
  }
}
