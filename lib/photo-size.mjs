// Photo size rules for Farm Vision uploads (2026-11-27). Pure, so they can be tested.
//
// Current Claude vision models see at most 2576 pixels on the long side; a larger picture is shrunk by the provider
// before the model looks at it. So the phone shrinks to that size before sending: the model gets the same detail and
// the upload is several times smaller. Change MAX_EDGE here if the vision model's limit changes.

export const MAX_EDGE = 2576;
/** A photo already within the size and under this many bytes is sent as it is. */
export const KEEP_BYTES = 1_500_000;
export const JPEG_QUALITY = 0.9;

/**
 * The size to send a width x height photo at: never larger than MAX_EDGE on the long side, never enlarged.
 * Returns null when the photo should be sent unchanged.
 */
export function targetSize(width, height, bytes, maxEdge = MAX_EDGE) {
  if (!(width > 0 && height > 0)) return null;
  const long = Math.max(width, height);
  if (long <= maxEdge && bytes <= KEEP_BYTES) return null;
  const scale = Math.min(1, maxEdge / long);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Wait before retry number `attempt` (1-based) of an upload that lost its connection. */
export function retryDelayMs(attempt) {
  return [2000, 5000, 10000][attempt - 1] ?? null;
}

/** An upload request id from the phone: a random UUID, so a retry is recognised and never runs or charges twice. */
export function validRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value);
}
