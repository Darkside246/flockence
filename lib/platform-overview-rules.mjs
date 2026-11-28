/**
 * Platform console (operator only): one row per farm, built from counts the server already keeps. Pure so it can be
 * tested without a database. Rows needing attention (deletion pending, no owner, quiet for a long time) sort first.
 */
export const QUIET_DAYS = 14;

/**
 * @param {{ id: string; name: string; createdAt: Date }[]} farms
 * @param {{
 *   users: Map<string, { total: number; owners: { name: string; email: string }[] }>;
 *   activeFlocks: Map<string, number>;
 *   lastActivity: Map<string, Date>;
 *   storageBytes: Map<string, number>;
 *   visionMonth: Map<string, { checks: number; costMicros: number }>;
 *   deletionPending: Set<string>;
 * }} facts
 * @param {Date} now
 */
export function buildFarmRows(farms, facts, now) {
  return farms.map((farm) => {
    const users = facts.users.get(farm.id) ?? { total: 0, owners: [] };
    const last = facts.lastActivity.get(farm.id) ?? null;
    const quietDays = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
    const flags = [];
    if (facts.deletionPending.has(farm.id)) flags.push("Deletion pending");
    if (!users.owners.length) flags.push("No owner");
    if (quietDays === null || quietDays >= QUIET_DAYS) flags.push(quietDays === null ? "No activity yet" : `Quiet ${quietDays} days`);
    const vision = facts.visionMonth.get(farm.id) ?? { checks: 0, costMicros: 0 };
    return {
      id: farm.id, name: farm.name, createdAt: farm.createdAt,
      members: users.total, owners: users.owners,
      activeFlocks: facts.activeFlocks.get(farm.id) ?? 0,
      lastActivity: last, quietDays,
      storageBytes: facts.storageBytes.get(farm.id) ?? 0,
      visionChecks: vision.checks, visionCostMicros: vision.costMicros,
      flags,
    };
  }).sort((a, b) => (b.flags.length > 0 ? 1 : 0) - (a.flags.length > 0 ? 1 : 0) || a.name.localeCompare(b.name));
}

export function platformTotals(rows) {
  return {
    farms: rows.length,
    members: rows.reduce((s, r) => s + r.members, 0),
    activeFlocks: rows.reduce((s, r) => s + r.activeFlocks, 0),
    storageBytes: rows.reduce((s, r) => s + r.storageBytes, 0),
    visionChecks: rows.reduce((s, r) => s + r.visionChecks, 0),
    visionCostMicros: rows.reduce((s, r) => s + r.visionCostMicros, 0),
    needAttention: rows.filter((r) => r.flags.length).length,
  };
}

/** US dollars from millionths, as the vision usage records them. */
export function formatUsd(micros) {
  const dollars = (Number(micros) || 0) / 1_000_000;
  return "US$" + dollars.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Read one VISION_USAGE::YYYY-MM setting value; bad JSON counts as nothing. */
export function readVisionMonth(text) {
  try {
    const v = JSON.parse(text ?? "");
    const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    return { checks: n(v?.manual) + n(v?.automatic), costMicros: n(v?.costMicros) };
  } catch { return { checks: 0, costMicros: 0 }; }
}
