// ChickenVerse bird-count test (2026-11-27): the pure parts, so they can be tested without the network.
// The test reads only what it needs from the official ChickenDet.zip (its index, the Test annotations and the
// sampled pictures) and compares Farm Vision's visible-bird count with the number of birds the researchers boxed.

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

/** Where the zip's central directory is, from the last bytes of the file (handles zip64, needed above 4 GB). */
export function findCentralDirectory(tail, tailStart) {
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a zip file: no end-of-directory record.");
  let size = u32(tail, eocd + 12), offset = u32(tail, eocd + 16), entries = u16(tail, eocd + 10);
  const locator = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
  if (locator >= 0) {
    const recordAt = u64(tail, locator + 8) - tailStart;
    if (recordAt < 0 || u32(tail, recordAt) !== 0x06064b50) throw new Error("The zip64 directory record is outside the bytes read.");
    entries = u64(tail, recordAt + 32); size = u64(tail, recordAt + 40); offset = u64(tail, recordAt + 48);
  }
  return { entries, size, offset };
}

/** The entries of a central directory: name, compression, sizes and where each local header starts. */
export function readCentralDirectory(buf) {
  const out = new Map();
  let p = 0;
  while (p + 46 <= buf.length && u32(buf, p) === 0x02014b50) {
    const method = u16(buf, p + 10), nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    let compressed = u32(buf, p + 20), size = u32(buf, p + 24), header = u32(buf, p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // zip64 extra field: only the values stored as 0xFFFFFFFF are present, in this order.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = u16(buf, e), len = u16(buf, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(buf, q); q += 8; }
        if (compressed === 0xffffffff) { compressed = u64(buf, q); q += 8; }
        if (header === 0xffffffff) { header = u64(buf, q); q += 8; }
      }
      e += 4 + len;
    }
    if (!name.endsWith("/")) out.set(name, { name, method, compressed, size, header });
    p = end + commentLen;
  }
  return out;
}

/** Where an entry's data starts, from its 30-byte local header (whose name and extra lengths can differ). */
export function dataStart(localHeader, headerOffset) {
  if (u32(localHeader, 0) !== 0x04034b50) throw new Error("Bad local file header.");
  return headerOffset + 30 + u16(localHeader, 26) + u16(localHeader, 28);
}

/**
 * Boxed birds per picture from a COCO annotation file. Every box is one bird. ChickenDet's export marks every box
 * "iscrowd" (all 12,620 in Test), so that flag is kept for the record but does not change the count.
 */
export function groundTruth(coco) {
  const counts = new Map();
  for (const image of coco.images ?? []) counts.set(image.id, { id: image.id, file: String(image.file_name).split("/").pop(), birds: 0, crowd: 0 });
  for (const a of coco.annotations ?? []) {
    const row = counts.get(a.image_id);
    if (!row) continue;
    row.birds += 1;
    if (a.iscrowd) row.crowd += 1;
  }
  return [...counts.values()];
}

export const BUCKETS = [["0", 0, 0], ["1-10", 1, 10], ["11-30", 11, 30], ["31-60", 31, 60], ["61-100", 61, 100], ["over 100", 101, Infinity]];
export const bucketOf = (n) => BUCKETS.find(([, lo, hi]) => n >= lo && n <= hi)[0];

function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A repeatable sample spread across crowding levels (round robin over the buckets), so busy pens are tested too. */
export function samplePictures(rows, n, seed = 42) {
  const rand = prng(seed);
  const groups = new Map(BUCKETS.map(([name]) => [name, []]));
  for (const row of [...rows].sort((a, b) => a.file.localeCompare(b.file))) groups.get(bucketOf(row.birds)).push(row);
  for (const list of groups.values()) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  const out = [];
  while (out.length < n && [...groups.values()].some((l) => l.length)) for (const list of groups.values()) if (list.length && out.length < n) out.push(list.shift());
  return out;
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Accuracy figures for rows of {truth, predicted (number or null), confidence}. */
export function scoreCounts(rows) {
  const answered = rows.filter((r) => Number.isInteger(r.predicted));
  const errors = answered.map((r) => r.predicted - r.truth);
  const abs = errors.map(Math.abs);
  const pct = answered.filter((r) => r.truth > 0).map((r) => Math.abs(r.predicted - r.truth) / r.truth);
  return {
    pictures: rows.length,
    counted: answered.length,
    notCounted: rows.length - answered.length,
    meanAbsoluteError: round(abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : null),
    medianAbsoluteError: round(median(abs)),
    meanPercentError: round(pct.length ? (100 * pct.reduce((a, b) => a + b, 0)) / pct.length : null),
    within10Percent: round(pct.length ? (100 * pct.filter((x) => x <= 0.1).length) / pct.length : null),
    within20Percent: round(pct.length ? (100 * pct.filter((x) => x <= 0.2).length) / pct.length : null),
    exact: answered.filter((r) => r.predicted === r.truth).length,
    // Positive: Vision counts more birds than there are; negative: it misses birds.
    meanBias: round(errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null),
  };
}

/** The whole report: overall, by crowding level and by the confidence the model gave. */
export function countReport(rows) {
  const by = (key) => Object.fromEntries([...new Set(rows.map(key))].filter(Boolean).sort().map((k) => [k, scoreCounts(rows.filter((r) => key(r) === k))]));
  return {
    overall: scoreCounts(rows),
    byCrowding: Object.fromEntries(BUCKETS.map(([name]) => [name, rows.filter((r) => bucketOf(r.truth) === name)]).filter(([, l]) => l.length).map(([k, l]) => [k, scoreCounts(l)])),
    byConfidence: by((r) => r.confidence),
  };
}
