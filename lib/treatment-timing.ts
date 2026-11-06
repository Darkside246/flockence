// When a treated flock may go for food again. The withdrawal period counts from the END of the treatment (the last dose),
// not from the day it started: a 5-day course with a 7-day withdrawal clears 12 days after it began, not 7.
// Pure, so it can be tested.

const addDays = (from: Date, days: number) => {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

/**
 * The first day the flock is clear, or null when there is no withdrawal.
 * The end of the treatment is the recorded end date, or the start plus the course length, or (for a single dose) the start.
 */
export function withdrawalClearsAt(startedAt: Date, endedAt: Date | null, durationDays: number | null | undefined, withdrawalDays: number): Date | null {
  if (!Number.isFinite(withdrawalDays) || withdrawalDays <= 0) return null;
  const courseEnd = endedAt ?? (durationDays && durationDays > 0 ? addDays(startedAt, Math.round(durationDays)) : startedAt);
  return addDays(courseEnd, Math.round(withdrawalDays));
}
