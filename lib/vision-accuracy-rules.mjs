/**
 * Farm Vision accuracy (Vision Intelligence phase 2, part one, 28 Nov 2026). The farmer labels a check with what was
 * really in the picture (birds in view, dead or down birds, floor eggs). These rules compare that with what the model
 * said, and with the bird counter when it ran, so the farm sees measured accuracy instead of the model's own
 * confidence. The labelled checks also make the evaluation set for the CPU bird detector.
 */
export const LABEL_PREFIX = "VISION_LABEL_V1::";
export const DEPENDABLE_AFTER = 20;

const whole = (v, max) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : undefined);

/** A label from the form or a saved setting; undefined when any value is not a sensible whole number. */
export function cleanLabel(input) {
  const birds = whole(input?.birds, 100000), deadOrDown = whole(input?.deadOrDown, 500), floorEggs = whole(input?.floorEggs, 10000);
  if (birds === undefined || deadOrDown === undefined || floorEggs === undefined) return undefined;
  if (birds === null && deadOrDown === null && floorEggs === null) return null;
  return { birds, deadOrDown, floorEggs };
}

export function parseSavedLabel(text) {
  try {
    const v = JSON.parse(text ?? "");
    const label = cleanLabel(v);
    return label ? { ...label, by: typeof v.by === "string" ? v.by : null, at: typeof v.at === "string" ? v.at : null } : null;
  } catch { return null; }
}

/**
 * What the model said about one check. New checks carry `seen`; older ones only have the note text, so the counts are
 * read back from it ("Birds visible: about 42", the "Birds lying still" list).
 */
export function modelSaid(assessment, notes) {
  const a = assessment && typeof assessment === "object" ? assessment : {};
  let birds = Number.isInteger(a.seen?.birds) ? a.seen.birds : null;
  let stillBirds = Number.isInteger(a.seen?.stillBirds) ? a.seen.stillBirds : null;
  const text = typeof notes === "string" ? notes : "";
  if (birds === null) { const m = text.match(/Birds visible: about (\d{1,6})/); birds = m ? Number(m[1]) : null; }
  if (stillBirds === null) {
    const block = text.split(/\n\n/).find((part) => part.startsWith("Birds lying still"));
    stillBirds = block ? block.split("\n").filter((line) => line.startsWith("- ")).length : 0;
  }
  const detector = Number.isInteger(a.detector?.count) ? a.detector.count : null;
  const floorEggs = Number.isInteger(a.eggs?.floorEggs) ? a.eggs.floorEggs : null;
  return { birds, stillBirds, detector, floorEggs };
}

function countError(pairs) {
  if (!pairs.length) return null;
  const abs = pairs.map(([said, real]) => Math.abs(said - real));
  const pct = pairs.filter(([, real]) => real > 0).map(([said, real]) => Math.abs(said - real) / real);
  return {
    checks: pairs.length,
    meanMiss: Math.round((abs.reduce((s, v) => s + v, 0) / abs.length) * 10) / 10,
    meanMissPercent: pct.length ? Math.round((pct.reduce((s, v) => s + v, 0) / pct.length) * 1000) / 10 : null,
    within10Percent: pct.length ? Math.round((pct.filter((v) => v <= 0.1).length / pct.length) * 100) : null,
  };
}

/**
 * @param {{ label: { birds: number|null; deadOrDown: number|null; floorEggs: number|null }; said: ReturnType<typeof modelSaid> }[]} rows
 * @param {{ confirmed: number; dismissed: number }} reviewedDeadBirdFindings
 */
export function accuracyReport(rows, reviewedDeadBirdFindings = { confirmed: 0, dismissed: 0 }) {
  const labelled = rows.filter((r) => r.label);
  const modelCount = countError(labelled.filter((r) => r.label.birds !== null && r.said.birds !== null).map((r) => [r.said.birds, r.label.birds]));
  const detectorCount = countError(labelled.filter((r) => r.label.birds !== null && r.said.detector !== null).map((r) => [r.said.detector, r.label.birds]));
  const floorEggs = countError(labelled.filter((r) => r.label.floorEggs !== null && r.said.floorEggs !== null).map((r) => [r.said.floorEggs, r.label.floorEggs]));
  const dead = labelled.filter((r) => r.label.deadOrDown !== null);
  const found = dead.filter((r) => r.label.deadOrDown > 0 && r.said.stillBirds > 0).length;
  const missed = dead.filter((r) => r.label.deadOrDown > 0 && r.said.stillBirds === 0).length;
  const falseAlarms = dead.filter((r) => r.label.deadOrDown === 0 && r.said.stillBirds > 0).length;
  const quiet = dead.filter((r) => r.label.deadOrDown === 0 && r.said.stillBirds === 0).length;
  const reviewed = reviewedDeadBirdFindings.confirmed + reviewedDeadBirdFindings.dismissed;
  return {
    labelled: labelled.length, checks: rows.length, dependable: labelled.length >= DEPENDABLE_AFTER,
    birdCount: { model: modelCount, counter: detectorCount },
    deadBirds: {
      checks: dead.length, found, missed, falseAlarms, quiet,
      foundPercent: found + missed ? Math.round((found / (found + missed)) * 100) : null,
      falseAlarmPercent: falseAlarms + quiet ? Math.round((falseAlarms / (falseAlarms + quiet)) * 100) : null,
    },
    floorEggs,
    reviewedFindings: { ...reviewedDeadBirdFindings, rightPercent: reviewed ? Math.round((reviewedDeadBirdFindings.confirmed / reviewed) * 100) : null },
  };
}

const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
/** The labelled checks as a CSV evaluation set: one row per picture. */
export function evaluationCsv(rows) {
  const head = ["observation_id", "observed_at", "camera", "pen", "picture", "label_birds", "label_dead_or_down", "label_floor_eggs", "model_birds", "model_still_birds", "counter_birds", "model_floor_eggs"];
  const lines = rows.filter((r) => r.label).map((r) => [r.id, r.observedAt, r.camera, r.pen, r.imageUrl, r.label.birds, r.label.deadOrDown, r.label.floorEggs, r.said.birds, r.said.stillBirds, r.said.detector, r.said.floorEggs].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
