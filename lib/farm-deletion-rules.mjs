/**
 * Self-service farm deletion (owner, 28 Nov 2026): the owner confirms by typing the farm name, the farm is locked at
 * once (only the owner can still sign in, to download the data or cancel), and it is deleted permanently after a
 * 30-day grace period unless the owner cancels. The installation's home farm (FARM_ID) can never be deleted this way.
 */
export const GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

/** The saved request for this farm, or null. Bad or missing data is treated as no request (never as "delete"). */
export function parseDeletion(value) {
  try {
    const data = JSON.parse(value ?? "null");
    if (!data || typeof data !== "object") return null;
    const requestedAt = Date.parse(data.requestedAt), deleteAfter = Date.parse(data.deleteAfter);
    if (!Number.isFinite(requestedAt) || !Number.isFinite(deleteAfter) || deleteAfter < requestedAt + (GRACE_DAYS - 1) * DAY_MS) return null;
    return { requestedAt: data.requestedAt, deleteAfter: data.deleteAfter, requestedBy: String(data.requestedBy ?? "") };
  } catch {
    return null;
  }
}

export function newDeletion(now, userId) {
  return { requestedAt: now.toISOString(), deleteAfter: new Date(now.getTime() + GRACE_DAYS * DAY_MS).toISOString(), requestedBy: userId };
}

export function deletionStatus(deletion, now) {
  if (!deletion) return { pending: false };
  const left = Date.parse(deletion.deleteAfter) - now.getTime();
  return { pending: true, deleteAfter: deletion.deleteAfter, daysLeft: Math.max(0, Math.ceil(left / DAY_MS)), due: left <= 0 };
}

/** The farm name typed to confirm must match, ignoring case and surrounding spaces. */
export function confirmsFarmName(typed, farmName) {
  const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return clean(farmName).length > 0 && clean(typed) === clean(farmName);
}

export function canDeleteFarm(farmId, homeFarmId) {
  return Boolean(farmId) && farmId !== homeFarmId;
}
