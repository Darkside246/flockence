/**
 * Farm Vision storage per plan (owner, 28 Nov 2026): Free 1 GB, Standard 10 GB, Premium 50 GB. When a farm is full, the
 * oldest pictures older than 90 days are removed first (the written result stays, only the picture goes); if that is not
 * enough, new checks are refused with a clear message instead of filling the server's disk. The owner sees usage, with a
 * warning from 80%. STORAGE_PLAN_LIMITS_GB in the server environment can override the sizes, e.g. {"FREE":0.5}.
 */

export const GB = 1_000_000_000;
export const DEFAULT_STORAGE_GB = { FREE: 1, STANDARD: 10, PREMIUM: 50 };
export const PRUNE_MIN_AGE_DAYS = 90;
export const WARN_AT = 0.8;
/** After pruning, aim for this share of the limit so the next checks do not prune again straight away. */
export const PRUNE_TARGET = 0.95;

export function storageLimitBytes(plan, overridesText = "") {
  let overrides = {};
  try { overrides = JSON.parse(overridesText || "{}"); } catch { /* keep defaults */ }
  const value = Number(overrides && typeof overrides === "object" ? overrides[plan] : NaN);
  const gb = Number.isFinite(value) && value > 0 ? value : DEFAULT_STORAGE_GB[plan] ?? DEFAULT_STORAGE_GB.FREE;
  return Math.round(gb * GB);
}

export function storageStatus(usedBytes, limitBytes) {
  const used = Math.max(0, Number(usedBytes) || 0);
  const ratio = limitBytes > 0 ? used / limitBytes : 1;
  return { used, limit: limitBytes, percent: Math.min(100, Math.round(ratio * 1000) / 10), level: ratio >= 1 ? "full" : ratio >= WARN_AT ? "warn" : "ok" };
}

/** Bytes to remove before saving `extraBytes` more, or 0 when it fits. */
export function bytesToFree(usedBytes, extraBytes, limitBytes) {
  if (usedBytes + extraBytes <= limitBytes) return 0;
  return Math.max(0, Math.ceil(usedBytes + extraBytes - limitBytes * PRUNE_TARGET));
}

export function formatBytes(bytes) {
  if (bytes >= GB) return `${(Math.round((bytes / GB) * 10) / 10).toLocaleString("en")} GB`;
  return `${Math.max(0, Math.round(bytes / 1_000_000)).toLocaleString("en")} MB`;
}
