// Recording checks across the day (Vision Intelligence phase 3, 2026-11-27). Pure rules, so they can be tested.
//
// Live checks only see the moment they run. Saved recordings (Blink cloud clips, or the server's own recordings) let
// Vision look at each part of the farm's day: for each camera, one clip from each part of the last 24 hours that has
// not been checked yet, the one nearest the middle of that part. Parts with no recording are said plainly.

export const DAY_PARTS = [
  { name: "night", from: 0, to: 5 }, { name: "morning", from: 5, to: 11 }, { name: "midday", from: 11, to: 15 },
  { name: "afternoon", from: 15, to: 19 }, { name: "evening", from: 19, to: 24 },
];
/** At most this many recording checks in one round (each is a paid vision call); later rounds fill the rest. */
export const RECORDINGS_PER_ROUND = 2;
const DAY_MS = 86_400_000;

export const partOf = (hour) => DAY_PARTS.find((p) => hour >= p.from && hour < p.to)?.name ?? "night";

/**
 * Which clips to check now. clips: [{id, camera, createdAt, source, media}]; hourOf(date) gives the farm's hour;
 * state: {done: {clipId: iso}, covered: {"camera|part": iso of the clip checked}}. Returns at most `limit` picks,
 * oldest part first, so the day fills in order.
 */
export function pickRecordingChecks(clips, state, now, hourOf, limit = RECORDINGS_PER_ROUND, cameras = null) {
  const since = now.getTime() - DAY_MS;
  const done = state?.done ?? {};
  const covered = state?.covered ?? {};
  const candidates = new Map();
  for (const c of clips) {
    const at = Date.parse(c.createdAt);
    if (!Number.isFinite(at) || at < since || at > now.getTime() || done[c.id] || !c.media) continue;
    if (cameras && !cameras.includes(c.camera)) continue;
    const hour = hourOf(new Date(at));
    const part = partOf(hour);
    const key = `${c.camera}|${part}`;
    const last = covered[key] ? Date.parse(covered[key]) : NaN;
    if (Number.isFinite(last) && last >= since) continue;   // this camera's part of the day is already checked
    const spec = DAY_PARTS.find((p) => p.name === part);
    const distance = Math.abs(hour + new Date(at).getMinutes() / 60 - (spec.from + spec.to) / 2);
    const best = candidates.get(key);
    if (!best || distance < best.distance) candidates.set(key, { clip: c, camera: c.camera, part, at, distance });
  }
  return [...candidates.values()].sort((a, b) => a.at - b.at).slice(0, limit).map(({ clip, camera, part }) => ({ clip, camera, part }));
}

/** Record a checked clip; forget anything older than two days. */
export function markChecked(state, pick, now) {
  const keep = now.getTime() - 2 * DAY_MS;
  const done = Object.fromEntries(Object.entries(state?.done ?? {}).filter(([, at]) => Date.parse(at) >= keep));
  const covered = Object.fromEntries(Object.entries(state?.covered ?? {}).filter(([, at]) => Date.parse(at) >= keep));
  done[pick.clip.id] = pick.clip.createdAt;
  covered[`${pick.camera}|${pick.part}`] = pick.clip.createdAt;
  return { done, covered };
}

/** Parts of the last 24 hours with no recording at all, per camera (for the report's coverage note). */
export function missingParts(clips, cameras, now, hourOf) {
  const since = now.getTime() - DAY_MS;
  const seen = new Set();
  for (const c of clips) {
    const at = Date.parse(c.createdAt);
    if (Number.isFinite(at) && at >= since && at <= now.getTime()) seen.add(`${c.camera}|${partOf(hourOf(new Date(at)))}`);
  }
  return Object.fromEntries(cameras.map((cam) => [cam, DAY_PARTS.map((p) => p.name).filter((p) => !seen.has(`${cam}|${p}`))]));
}
