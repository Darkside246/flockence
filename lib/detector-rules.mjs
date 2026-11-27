// The bird counter (Vision Intelligence phase 2, 2026-11-27): pure rules, so they can be tested. The counter is a
// separate detector service (services/detector) that returns one box per bird it finds in each picture. It is switched
// off until there is a machine to run it (lib/bird-detector.ts). These rules turn its boxes into what Vision uses.

/** Overlap of two boxes [x1, y1, x2, y2] (intersection over union, 0 to 1). */
export function iou(a, b) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/** Boxes the detector is at least `minScore` sure of. Box: [x1, y1, x2, y2, score], coordinates 0..1 of the picture. */
export function confident(boxes, minScore = 0.35) {
  return (boxes ?? []).filter((b) => Array.isArray(b) && b.length >= 5 && b[4] >= minScore && b[2] > b[0] && b[3] > b[1]);
}

/**
 * Birds that did not move: in every frame a box overlaps the first frame's box almost exactly, while other birds moved.
 * Only meaningful when frames are a few seconds or more apart (video samples, recordings). Returns boxes from frame 1.
 */
export function stillBirds(frames, { sameIou = 0.85, minMovedShare = 0.2 } = {}) {
  if (!Array.isArray(frames) || frames.length < 2) return [];
  const [first, ...rest] = frames.map((f) => confident(f));
  if (!first.length) return [];
  const stays = (box) => rest.every((boxes) => boxes.some((b) => iou(box, b) >= sameIou));
  const still = first.filter(stays);
  // If almost nothing moved (a still picture repeated, or all birds resting), stillness says nothing.
  if (first.length - still.length < Math.max(1, Math.round(first.length * minMovedShare))) return [];
  return still;
}

/** Where in the picture a box is, in words the farmer can find ("lower left", "middle"). */
export function whereInPicture(box) {
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const col = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "centre";
  const row = cy < 1 / 3 ? "upper" : cy > 2 / 3 ? "lower" : "middle";
  return row === "middle" && col === "centre" ? "middle" : `${row} ${col}`;
}

/** What the counter adds to an inspection: the count in the clearest frame and the still birds. */
export function summariseDetections(frames, model) {
  const counts = frames.map((f) => confident(f).length);
  const still = stillBirds(frames);
  return { model, counts, count: counts.length ? Math.max(...counts) : 0, still: still.map((b) => ({ where: whereInPicture(b), box: b.slice(0, 4).map((v) => Math.round(v * 1000) / 1000) })) };
}
