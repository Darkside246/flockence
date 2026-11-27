// Flockence reconciliation engine: pure functions, no database, no clock.
//
// Every number here is derived from recorded events. Nothing is stored that cannot be rebuilt from them.
// Counts (birds, eggs) use integers. Weights and volumes are summed as whole grams / millilitres so that
// 0.1 + 0.2 never becomes 0.30000000000000004; results are returned in kg / litres to 3 decimals.
//
// Each result says how it was obtained (`basis`) and how sure it is (`status`):
//   MEASURED | RECORDED | CALCULATED | ESTIMATED | FORECAST | UNVERIFIED | MISSING

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------
const isWhole = v => Number.isSafeInteger(v) && v >= 0;
const toMilli = v => Math.round(Number(v) * 1000);
const fromMilli = m => Math.round(m) / 1000;
const day = d => { const t = new Date(d); return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null; };
const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
const finite = v => typeof v === "number" && Number.isFinite(v);

/** Sum kilograms exactly (to the gram). */
export function sumKg(values) {
  let m = 0;
  for (const v of values) if (v != null && v !== "") m += toMilli(v);
  return fromMilli(m);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Bird balance
// ---------------------------------------------------------------------------------------------------------------
/** Event types that change how many birds a flock has. Transfers move birds between houses inside the flock. */
export const BIRD_EVENT_TYPES = Object.freeze({
  ADDITION: +1,        // birds added to the flock (bought or hatched in), with source and date
  MORTALITY: -1,       // found dead
  CULL: -1,            // removed on purpose (weak, injured); not the same as found dead
  SLAUGHTER: -1,       // sent to the processor (includes any condemned there); never mortality
  MISSING: -1,         // confirmed gone, cause unknown (predator, theft); only when the farmer says so
  TRANSFER_IN: 0,      // into a house; the flock total does not change
  TRANSFER_OUT: 0,     // out of a house; the flock total does not change
});

/**
 * Closing = opening + additions − mortality − culls − slaughtered − missing, from the events alone.
 * A head count is an observation: the live figure follows the latest head count plus events after it, and the gap
 * between the count and the books is reported as "unaccounted", never booked as mortality.
 *
 * @param {object} p
 * @param {number} p.initialBirds         birds placed
 * @param {Array<{type:string,quantity:number,date:string|Date,createdAt?:string|Date,house?:string|null,fromHouse?:string|null,toHouse?:string|null}>} p.events
 * @param {Array<{count:number,date:string|Date,createdAt?:string|Date}>} [p.headCounts]
 * @param {string|Date} [p.asOf]          inclusive day
 * @param {string|null} [p.placementHouse]
 */
export function birdBalance({ initialBirds, events = [], headCounts = [], asOf, placementHouse = null }) {
  if (!isWhole(initialBirds)) return { ok: false, error: "The starting number of birds is not a whole number." };
  const cut = asOf ? day(asOf) : null;
  const within = e => !cut || (day(e.date) && day(e.date) <= cut);
  const order = (a, b) => (day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : new Date(a.createdAt ?? a.date) - new Date(b.createdAt ?? b.date));
  const evs = events.filter(within).sort(order);
  for (const e of evs) {
    if (!(e.type in BIRD_EVENT_TYPES)) return { ok: false, error: `Unknown bird event type: ${e.type}` };
    if (!isWhole(e.quantity) || e.quantity === 0) return { ok: false, error: `A ${e.type.toLowerCase()} must be a whole number of birds above zero.` };
  }
  const totals = { additions: 0, mortality: 0, culls: 0, slaughtered: 0, missing: 0, transfers: 0 };
  const key = { ADDITION: "additions", MORTALITY: "mortality", CULL: "culls", SLAUGHTER: "slaughtered", MISSING: "missing" };
  let book = initialBirds;
  const steps = [{ label: "Birds placed", change: initialBirds, balance: initialBirds, date: null }];
  const houses = new Map();
  const house = h => h || placementHouse || "Not assigned to a house";
  houses.set(house(null), initialBirds);
  const unassigned = house(null);
  // Birds taken out of a house: if the house holds fewer than that on the books, the rest are taken to be birds that
  // were never assigned to a house (the farmer has now said where they are), not a negative house.
  const bump = (h, n) => {
    if (n < 0 && h !== unassigned) {
      const short = -n - Math.max(0, houses.get(h) ?? 0);
      const pool = Math.max(0, houses.get(unassigned) ?? 0);
      const take = Math.min(Math.max(0, short), pool);
      if (take > 0) { houses.set(unassigned, pool - take); houses.set(h, (houses.get(h) ?? 0) + take); }
    }
    houses.set(h, (houses.get(h) ?? 0) + n);
  };

  // head counts in date order, applied as observations
  const counts = headCounts.filter(c => within(c) && isWhole(c.count)).sort(order);
  let ci = 0, observed = null, sinceObserved = 0;
  const observations = [];
  const applyCountsUpTo = (d, createdAt) => {
    while (ci < counts.length && (day(counts[ci].date) < d || (day(counts[ci].date) === d && createdAt && new Date(counts[ci].createdAt ?? counts[ci].date) <= new Date(createdAt)))) {
      const c = counts[ci++];
      const expected = observed === null ? book : observed + sinceObserved;
      observations.push({ date: day(c.date), counted: c.count, expected, unaccounted: c.count - expected });
      observed = c.count; sinceObserved = 0;
    }
  };

  for (const e of evs) {
    applyCountsUpTo(day(e.date), e.createdAt);
    const sign = BIRD_EVENT_TYPES[e.type];
    if (e.type === "TRANSFER_OUT" || e.type === "TRANSFER_IN") {
      totals.transfers += e.type === "TRANSFER_OUT" ? e.quantity : 0;
      if (e.type === "TRANSFER_OUT") bump(house(e.fromHouse ?? e.house), -e.quantity);
      else bump(house(e.toHouse ?? e.house), e.quantity);
      continue;
    }
    totals[key[e.type]] += e.quantity;
    const change = sign * e.quantity;
    book += change;
    if (observed !== null) sinceObserved += change;
    bump(house(e.house), change);
    steps.push({ label: labelFor(e.type), change, balance: book, date: day(e.date) });
  }
  applyCountsUpTo("9999-12-31");

  const live = observed === null ? book : observed + sinceObserved;
  if (book < 0 || live < 0) return { ok: false, error: "More birds have left the flock than were ever placed or added. Check the recorded events." };
  const houseRows = [...houses.entries()].filter(([, n]) => n !== 0).map(([name, birds]) => ({ name, birds }));
  // House totals are only as good as the house recorded on each event; a negative house is reported, not hidden.
  const houseWarning = houseRows.some(h => h.birds < 0) ? "Some events name a house the birds were never moved into. The flock total is right; the split by house is not." : null;
  const last = observations.at(-1) ?? null;
  return {
    ok: true,
    status: "CALCULATED",
    opening: initialBirds,
    ...totals,
    bookBalance: book,
    live,
    lastHeadCount: last,
    unaccounted: observations.reduce((s, o) => s + o.unaccounted, 0),
    observations,
    houses: houseRows,
    houseWarning,
    steps,
    basis: observed === null
      ? "Birds placed + added − died − culled − sent to slaughter − confirmed missing."
      : `Head count of ${last.counted} on ${last.date}, then the events recorded after it.`,
  };
}

function labelFor(type) {
  return { ADDITION: "Birds added", MORTALITY: "Died", CULL: "Culled", SLAUGHTER: "Sent to slaughter", MISSING: "Confirmed missing" }[type] ?? type;
}

/** Live birds on each day from `from` to `to` (inclusive), for bird-days and hen-days. */
export function dailyPopulation({ initialBirds, events = [], headCounts = [], from, to }) {
  const out = [];
  const start = new Date(day(from) + "T00:00:00Z"), end = new Date(day(to) + "T00:00:00Z");
  if (!(start <= end)) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const b = birdBalance({ initialBirds, events, headCounts, asOf: d });
    if (!b.ok) return [];
    out.push({ date: day(d), live: b.live });
  }
  return out;
}

/** Bird-days: the sum of the actual live population over the days in the period. */
export function birdDays(population) {
  return population.reduce((s, p) => s + (isWhole(p.live) ? p.live : 0), 0);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Eggs
// ---------------------------------------------------------------------------------------------------------------
/** Hen-day production % = eggs / hen-days × 100. For one day, hen-days = hens alive that day. */
export function henDayProduction(eggs, henDays) {
  if (!isWhole(eggs) || !isWhole(henDays) || henDays === 0) return { ok: false, status: "MISSING", error: "Needs eggs collected and the number of laying hens." };
  return { ok: true, status: "CALCULATED", percent: Math.round((eggs / henDays) * 10000) / 100, eggs, henDays, basis: `${eggs} eggs ÷ ${henDays} hen-days × 100` };
}

/**
 * Split a collection into saleable and not saleable. Only what the farmer recorded is classified; nothing is guessed.
 * Rule set decides which categories may be sold (dirty eggs, for example, depend on the farm's rules).
 */
export function classifyEggs(c, rules = { dirtySaleable: false }) {
  const collected = c.collected;
  const parts = { cracked: c.cracked ?? 0, broken: c.broken ?? 0, dirty: c.dirty ?? 0, floor: c.floor ?? 0, unsuitable: c.unsuitable ?? 0, household: c.household ?? 0, incubation: c.incubation ?? 0 };
  if (!isWhole(collected)) return { ok: false, error: "Eggs collected must be a whole number." };
  for (const [k, v] of Object.entries(parts)) if (!isWhole(v)) return { ok: false, error: `${k} must be a whole number.` };
  const classified = Object.values(parts).reduce((s, v) => s + v, 0);
  if (classified > collected) return { ok: false, error: `The breakdown (${classified}) is more than the eggs collected (${collected}).` };
  const damaged = parts.cracked + parts.broken + parts.unsuitable;
  const notForSale = damaged + parts.household + parts.incubation + (rules.dirtySaleable ? 0 : parts.dirty);
  return { ok: true, status: "CALCULATED", collected, damaged, notForSale, saleable: collected - notForSale, ...parts, basis: "Eggs collected minus the eggs you marked as damaged, kept, set for hatching" + (rules.dirtySaleable ? "." : " or dirty.") };
}

/**
 * Compare today's hen-day % with the flock's own recent baseline (median of the last days, at least 5 days).
 * The difference is reported; no reason is invented.
 */
export function compareToBaseline(todayPercent, recentPercents, { minDays = 5 } = {}) {
  const xs = recentPercents.filter(finite);
  if (xs.length < minDays) return { ok: false, status: "MISSING", note: `Needs at least ${minDays} recorded days of this flock to set a baseline (has ${xs.length}).` };
  const base = median(xs), spread = mad(xs) * 1.4826;
  const diff = Math.round((todayPercent - base) * 100) / 100;
  const z = spread > 0 ? diff / spread : (diff === 0 ? 0 : Infinity * Math.sign(diff));
  return { ok: true, status: "CALCULATED", baseline: Math.round(base * 100) / 100, difference: diff, direction: diff > 0 ? "above" : diff < 0 ? "below" : "level", unusual: Math.abs(z) >= 3.5, days: xs.length, basis: `Median of the flock's last ${xs.length} recorded days.` };
}

/** Stock = opening + in − out, per movement type, all from recorded movements. */
export function stockLedger(opening, movements) {
  let bal = opening;
  const byType = {};
  for (const m of movements) {
    if (!finite(m.quantity)) return { ok: false, error: "Every stock movement needs a quantity." };
    const signed = m.direction === "IN" ? m.quantity : -m.quantity;
    bal += signed;
    byType[m.type] = (byType[m.type] ?? 0) + m.quantity;
  }
  if (bal < 0) return { ok: false, error: "More has left the stock than came in." };
  return { ok: true, status: "CALCULATED", opening, closing: bal, byType };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Feed
// ---------------------------------------------------------------------------------------------------------------
/**
 * Store balance and flock consumption, kept apart:
 *   store closing = opening + received − issued + returned
 *   consumed (measured) = issued − leftover − spillage − returned, only when leftovers were measured
 * Without a leftover measurement, consumption is unknown: we report "issued" and say so, never issued-as-eaten.
 */
export function feedBalance({ openingKg = 0, receivedKg = [], issues = [] }) {
  const opening = toMilli(openingKg);
  const received = receivedKg.reduce((s, v) => s + toMilli(v), 0);
  let issued = 0, returned = 0, spill = 0, left = 0, measuredIssued = 0, unmeasured = 0;
  for (const i of issues) {
    const kg = toMilli(i.issuedKg);
    issued += kg;
    returned += toMilli(i.returnedKg ?? 0);
    spill += toMilli(i.spillageKg ?? 0);
    if (i.leftoverKg === null || i.leftoverKg === undefined || i.leftoverKg === "") { unmeasured += kg; continue; }
    left += toMilli(i.leftoverKg);
    measuredIssued += kg;
  }
  const store = opening + received - issued + returned;
  if (store < 0) return { ok: false, error: "More feed was issued than was in store. Check the opening stock and deliveries." };
  const measuredReturned = issues.filter(i => i.leftoverKg != null && i.leftoverKg !== "").reduce((s, i) => s + toMilli(i.returnedKg ?? 0), 0);
  const measuredSpill = issues.filter(i => i.leftoverKg != null && i.leftoverKg !== "").reduce((s, i) => s + toMilli(i.spillageKg ?? 0), 0);
  const consumed = measuredIssued - left - measuredSpill - measuredReturned;
  if (consumed < 0) return { ok: false, error: "Leftover, spillage and returns are more than the feed issued." };
  return {
    ok: true,
    storeClosingKg: fromMilli(store), storeStatus: "CALCULATED",
    issuedKg: fromMilli(issued), returnedKg: fromMilli(returned), spillageKg: fromMilli(spill), leftoverKg: fromMilli(left),
    consumedKg: measuredIssued > 0 ? fromMilli(consumed) : null,
    consumedStatus: measuredIssued > 0 ? (unmeasured > 0 ? "CALCULATED_PARTIAL" : "CALCULATED") : "MISSING",
    unmeasuredIssuedKg: fromMilli(unmeasured),
    basis: unmeasured > 0
      ? `${fromMilli(unmeasured)} kg was issued without a leftover measurement, so how much of it was eaten is not known.`
      : "Feed issued minus what was left in the feeders, spilled and returned.",
  };
}

/** kg per bird-day; null when either side is missing. */
export function perBirdDay(totalKg, days) {
  if (!finite(num(totalKg)) || !isWhole(days) || days === 0) return null;
  return Math.round((Number(totalKg) / days) * 100000) / 100000;
}

/**
 * Feed conversion ratio, only when the weights exist. Method stated: feed ÷ (live weight gained by the birds alive at
 * the end + weight of birds that died or left during the period, at their last known weight when supplied).
 */
export function feedConversion({ feedKg, startBirds, startAvgKg, endBirds, endAvgKg, lossesKg = null }) {
  const need = [feedKg, startBirds, startAvgKg, endBirds, endAvgKg].map(num);
  if (need.some(v => !finite(v))) return { ok: false, status: "MISSING", note: "Feed conversion needs feed used and a start and end average weight. Weigh a sample of birds to get it." };
  const gain = endBirds * endAvgKg - startBirds * startAvgKg + (finite(num(lossesKg)) ? Number(lossesKg) : 0);
  if (gain <= 0) return { ok: false, status: "UNVERIFIED", note: "The recorded weights show no weight gain, so a feed conversion cannot be worked out." };
  return { ok: true, status: "CALCULATED", fcr: Math.round((feedKg / gain) * 1000) / 1000, gainKg: Math.round(gain * 1000) / 1000, method: "Feed ÷ (end flock weight − start flock weight" + (finite(num(lossesKg)) ? " + weight of birds lost" : "") + ")" };
}

/** How long the feed in store lasts at the recent daily use; a forecast, labelled as one. */
export function feedCoverage({ storeKg, dailyUseKg, needUntilEndKg = null }) {
  if (!finite(num(storeKg)) || !finite(num(dailyUseKg)) || dailyUseKg <= 0) return { ok: false, status: "MISSING", note: "Needs feed in store and at least a few days of recorded use." };
  const days = Math.floor(storeKg / dailyUseKg);
  const shortKg = finite(num(needUntilEndKg)) ? Math.max(0, Math.round((needUntilEndKg - storeKg) * 1000) / 1000) : null;
  return { ok: true, status: "FORECAST", daysOfFeed: days, shortfallKg: shortKg, basis: `${storeKg} kg ÷ ${dailyUseKg} kg a day at the recent rate.` };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Water
// ---------------------------------------------------------------------------------------------------------------
/** Water disappearance from a measured opening and closing. Not "drunk": leaks and spills are inside it. */
export function waterUsed({ openingL, addedL = 0, closingL, otherUseL = 0 }) {
  const o = num(openingL), c = num(closingL);
  if (!finite(o) || !finite(c)) return { ok: false, status: "MISSING", note: "Needs a tank or meter reading at the start and the end." };
  const used = toMilli(o) + toMilli(addedL) - toMilli(c) - toMilli(otherUseL);
  if (used < 0) return { ok: false, status: "UNVERIFIED", note: "The readings show more water at the end than was available. Check the readings and refills." };
  return { ok: true, status: "MEASURED", litres: fromMilli(used), basis: "Opening + added − closing − other known use. Includes any leaks or spills." };
}

/** Successive meter readings (cumulative totals) to daily use. A reset or fall is flagged, not turned into negative use. */
export function meterUsage(readings) {
  const rs = [...readings].filter(r => finite(num(r.reading))).sort((a, b) => new Date(a.at) - new Date(b.at));
  const out = [];
  for (let i = 1; i < rs.length; i++) {
    const d = toMilli(rs[i].reading) - toMilli(rs[i - 1].reading);
    out.push(d < 0 ? { from: rs[i - 1].at, to: rs[i].at, litres: null, status: "UNVERIFIED", note: "Meter went backwards (reset or misread)." } : { from: rs[i - 1].at, to: rs[i].at, litres: fromMilli(d), status: "MEASURED" });
  }
  return out;
}

/** Water-to-feed ratio, only when both were measured on the same basis. */
export function waterToFeed(waterL, feedKg) {
  if (!finite(num(waterL)) || !finite(num(feedKg)) || Number(feedKg) <= 0) return null;
  return Math.round((Number(waterL) / Number(feedKg)) * 100) / 100;
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Heat
// ---------------------------------------------------------------------------------------------------------------
/**
 * Min, max, time-weighted average, time outside the range and degree-hours above/below, from timestamped readings.
 * Gaps longer than `maxGapMinutes` are not bridged (the sensor was offline; nothing is invented for that time).
 */
export function temperatureExposure(readings, { low = null, high = null, maxGapMinutes = 90 } = {}) {
  const rs = readings.filter(r => finite(num(r.c)) && Number.isFinite(new Date(r.at).getTime())).sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!rs.length) return { ok: false, status: "MISSING", note: "No temperature readings for this period." };
  let min = Infinity, max = -Infinity, wSum = 0, wT = 0, hotH = 0, coldH = 0, aboveDH = 0, belowDH = 0, gapH = 0;
  for (const r of rs) { min = Math.min(min, r.c); max = Math.max(max, r.c); }
  for (let i = 1; i < rs.length; i++) {
    const h = (new Date(rs[i].at) - new Date(rs[i - 1].at)) / 3600000;
    if (h * 60 > maxGapMinutes) { gapH += h; continue; }
    const a = Number(rs[i - 1].c), b = Number(rs[i].c), mid = (a + b) / 2;
    wSum += mid * h; wT += h;
    if (high != null && mid > high) { hotH += h; aboveDH += (mid - high) * h; }
    if (low != null && mid < low) { coldH += h; belowDH += (low - mid) * h; }
  }
  const r2 = v => Math.round(v * 100) / 100;
  return {
    ok: true, status: "MEASURED", readings: rs.length, minC: min, maxC: max,
    averageC: wT > 0 ? r2(wSum / wT) : r2(rs.reduce((s, r) => s + r.c, 0) / rs.length),
    hoursAbove: r2(hotH), hoursBelow: r2(coldH), degreeHoursAbove: r2(aboveDH), degreeHoursBelow: r2(belowDH), hoursWithoutReadings: r2(gapH),
    basis: "Time-weighted between readings. Gaps longer than " + maxGapMinutes + " minutes are left out, not filled in.",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Slaughter yield and live-weight estimate
// ---------------------------------------------------------------------------------------------------------------
/** What a recovered weight includes. The ratio used must have been measured on the same definition. */
export const YIELD_DEFINITIONS = Object.freeze({
  CARCASS: "Dressed carcass only (no giblets, neck, feet or head)",
  CARCASS_WITH_GIBLETS: "Dressed carcass with the giblets packed inside",
  RECOVERED_TOTAL: "Carcass plus every separately weighed part returned (giblets, neck, feet, head)",
});

/**
 * Total recovered product, counting each part once. If giblets are already inside the carcass weight they are not
 * added again.
 */
export function recoveredWeight({ carcassKg, gibletsInsideCarcass = false, gibletsKg = null, neckKg = null, feetKg = null, headKg = null, otherKg = [] }) {
  if (!finite(num(carcassKg)) || carcassKg <= 0) return { ok: false, error: "Needs the carcass weight." };
  const parts = [gibletsInsideCarcass ? null : gibletsKg, neckKg, feetKg, headKg, ...otherKg].filter(v => finite(num(v)) && Number(v) > 0);
  const total = sumKg([carcassKg, ...parts]);
  const definition = parts.length ? "RECOVERED_TOTAL" : gibletsInsideCarcass ? "CARCASS_WITH_GIBLETS" : "CARCASS";
  return { ok: true, totalKg: total, definition, partsCounted: parts.length, note: gibletsInsideCarcass && finite(num(gibletsKg)) ? "Giblets are inside the carcass weight, so they were not added a second time." : null };
}

/**
 * Farm-specific recovery ratio from past batches where both live and recovered weight were measured, on one definition.
 * Returns mean ratio, standard deviation and sample size. With fewer than 3 batches there is not enough to calibrate.
 */
export function calibrateYield(samples, definition) {
  const xs = samples.filter(s => s.definition === definition && finite(num(s.liveKg)) && finite(num(s.recoveredKg)) && s.liveKg > 0 && s.recoveredKg > 0 && s.recoveredKg < s.liveKg)
    .map(s => s.recoveredKg / s.liveKg);
  if (xs.length < 3) return { ok: false, n: xs.length, note: `Needs at least 3 past batches with both live and ${definition === "CARCASS" ? "carcass" : "recovered"} weights on the same basis (has ${xs.length}).` };
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (xs.length - 1));
  return { ok: true, n: xs.length, ratio: mean, sd, definition };
}

/** Student-t 97.5% quantiles for small samples (two-sided 95%). */
const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086];
const tq = df => (df < T975.length ? T975[df] : 1.96 + 2.4 / df);

/**
 * Average live weight worked back from recovered output: recovered per bird ÷ recovery ratio.
 * The range is a 95% prediction range from the farm's own ratio spread: ratio ± t·sd·√(1+1/n).
 * With no calibration a published reference ratio may be passed, and the answer says it is a reference estimate.
 */
export function estimateLiveWeight({ recoveredKg, birds, definition, calibration = null, reference = null }) {
  if (!finite(num(recoveredKg)) || recoveredKg <= 0 || !isWhole(birds) || birds === 0) return { ok: false, status: "MISSING", note: "Needs the recovered weight and the number of birds processed." };
  const perBird = recoveredKg / birds;
  const r3 = v => Math.round(v * 1000) / 1000;
  if (calibration?.ok) {
    if (calibration.definition !== definition) return { ok: false, status: "UNVERIFIED", note: "The farm's recovery ratio was measured on a different product definition. It cannot be applied." };
    const half = tq(calibration.n - 1) * calibration.sd * Math.sqrt(1 + 1 / calibration.n);
    const lo = calibration.ratio + half, hi = Math.max(0.01, calibration.ratio - half);
    return {
      ok: true, status: "ESTIMATED", averageLiveKg: r3(perBird / calibration.ratio), rangeKg: [r3(perBird / lo), r3(perBird / hi)],
      recoveredPerBirdKg: r3(perBird), ratio: r3(calibration.ratio),
      basis: `Recovered ${r3(perBird)} kg a bird ÷ your farm's recovery ratio ${(calibration.ratio * 100).toFixed(1)}% (${calibration.n} past batches). The range is a 95% prediction range from how much that ratio has varied.`,
    };
  }
  if (reference && reference.definition === definition && finite(reference.low) && finite(reference.high) && reference.low > 0 && reference.high > reference.low) {
    const mid = (reference.low + reference.high) / 2;
    return {
      ok: true, status: "ESTIMATED", reference: true, averageLiveKg: r3(perBird / mid), rangeKg: [r3(perBird / reference.high), r3(perBird / reference.low)],
      recoveredPerBirdKg: r3(perBird), ratio: r3(mid),
      basis: `Reference estimate: recovered ${r3(perBird)} kg a bird ÷ a typical ratio of ${(reference.low * 100).toFixed(0)}–${(reference.high * 100).toFixed(0)}% (${reference.source}). Not calibrated to your farm yet; record live weights on a few batches to calibrate.`,
    };
  }
  return { ok: false, status: "MISSING", note: "No recovery ratio for this product definition. Weigh the birds alive on a few batches so the farm's own ratio can be learned." };
}

/** Typical ratios (published ranges, broilers). Used only as labelled reference estimates until the farm has its own. */
export const REFERENCE_YIELD = Object.freeze({
  CARCASS: { definition: "CARCASS", low: 0.70, high: 0.75, source: "typical broiler dressed carcass, without giblets" },
});

/** Processing yield and the part of the live weight not accounted for. Never fills the gap with a guess. */
export function processingYield({ liveKg = null, outputs = [] }) {
  const edible = sumKg(outputs.filter(o => o.kind === "EDIBLE").map(o => o.kg));
  const byproduct = sumKg(outputs.filter(o => o.kind === "BYPRODUCT").map(o => o.kg));
  const waste = sumKg(outputs.filter(o => o.kind === "WASTE").map(o => o.kg));
  const recorded = sumKg([edible, byproduct, waste]);
  const live = num(liveKg);
  return {
    ok: true, edibleKg: edible, byproductKg: byproduct, wasteKg: waste, recordedKg: recorded,
    yieldPercent: finite(live) && live > 0 ? Math.round((edible / live) * 10000) / 100 : null,
    unaccountedKg: finite(live) && live > 0 ? sumKg([live, -recorded]) : null,
    status: finite(live) ? "CALCULATED" : "MISSING",
    basis: finite(live) ? "Edible output ÷ live weight. Unaccounted = live weight − everything recorded (water lost in chilling, blood and feathers not weighed, and so on)." : "Live weight not recorded, so the yield and the unaccounted part cannot be worked out.",
  };
}

/** Will the expected meat fit in the store? Uses weight capacity; unknown items are reported, not ignored. */
export function storagePreflight({ expectedKg, capacityKg, storedKg, unweighedItems = 0, packagingAllowance = 0 }) {
  if (!finite(num(expectedKg)) || expectedKg <= 0) return { ok: false, status: "MISSING", note: "No expected output yet: needs a live-weight or past-yield estimate." };
  if (!finite(num(capacityKg)) || capacityKg <= 0) return { ok: false, status: "MISSING", note: "This storage location has no capacity recorded. Add its capacity in Storage." };
  const need = sumKg([expectedKg, expectedKg * packagingAllowance]);
  const free = sumKg([capacityKg, -(num(storedKg) ?? 0)]);
  return {
    ok: true, status: "ESTIMATED", requiredKg: need, freeKg: free, fits: need <= free && unweighedItems === 0,
    shortfallKg: need > free ? sumKg([need, -free]) : 0,
    warning: unweighedItems > 0 ? `${unweighedItems} item(s) in this store have no weight recorded, so the free space may be less than shown.` : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Unusual changes
// ---------------------------------------------------------------------------------------------------------------
export function median(xs) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function mad(xs) { const m = median(xs); return median(xs.map(v => Math.abs(v - m))); }
export function rollingAverage(xs, window) { return xs.map((_, i) => (i + 1 < window ? null : xs.slice(i + 1 - window, i + 1).reduce((s, v) => s + v, 0) / window)); }

/**
 * Robust check of one value against the flock's own history (modified z-score with median and MAD).
 * Says what changed, by how much and against what; it does not say why.
 */
export function unusualChange(label, value, history, { minHistory = 7, threshold = 3.5, unit = "" } = {}) {
  const xs = history.filter(finite);
  if (!finite(value) || xs.length < minHistory) return { ok: false, note: `Needs ${minHistory} earlier days to judge (has ${xs.length}).` };
  const m = median(xs), d = mad(xs);
  const z = d > 0 ? (0.6745 * (value - m)) / d : value === m ? 0 : Math.sign(value - m) * Infinity;
  const unusual = Math.abs(z) >= threshold;
  return {
    ok: true, unusual, z: finite(z) ? Math.round(z * 100) / 100 : z, value, baseline: m,
    change: Math.round((value - m) * 1000) / 1000,
    explanation: unusual ? `${label} was ${value}${unit}, against a usual ${m}${unit} over the last ${xs.length} days (${value > m ? "higher" : "lower"} by ${Math.abs(Math.round((value - m) * 1000) / 1000)}${unit}). Worth checking; this does not say why.` : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Feed in the feeders, day by day
// ---------------------------------------------------------------------------------------------------------------
/**
 * Per day: eaten = feed put out + what was left in the feeders the day before − left at the end − spilt − returned.
 * A day is "measured" only when its own leftover was weighed AND the opening amount is known (the day before was
 * weighed, or this is the first feed the flock had). Otherwise eaten is null: the feed was put out, how much was eaten is
 * not known.
 */
export function feederConsumption(days) {
  const rows = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  let opening = 0, openingKnown = true;
  const out = [];
  for (const d of rows) {
    const issued = toMilli(d.issuedKg ?? 0), spill = toMilli(d.spillageKg ?? 0), ret = toMilli(d.returnedKg ?? 0);
    const measured = d.leftoverKg !== null && d.leftoverKg !== undefined && d.leftoverKg !== "";
    const left = measured ? toMilli(d.leftoverKg) : null;
    let eaten = null, status = "MISSING";
    if (measured && openingKnown) {
      const e = issued + opening - left - spill - ret;
      if (e >= 0) { eaten = fromMilli(e); status = "CALCULATED"; } else status = "UNVERIFIED";
    }
    out.push({ date: d.date, issuedKg: fromMilli(issued), openingKg: openingKnown ? fromMilli(opening) : null, leftoverKg: measured ? fromMilli(left) : null, spillageKg: fromMilli(spill), returnedKg: fromMilli(ret), eatenKg: eaten, status });
    if (measured) { opening = left; openingKnown = true; } else { openingKnown = false; }
  }
  const measuredDays = out.filter(r => r.status === "CALCULATED");
  return { days: out, eatenKg: measuredDays.length ? sumKg(measuredDays.map(r => r.eatenKg)) : null, measuredDays: measuredDays.length, issuedKg: sumKg(out.map(r => r.issuedKg)), spillageKg: sumKg(out.map(r => r.spillageKg)) };
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Water tanks
// ---------------------------------------------------------------------------------------------------------------
/** Tank level readings: used = previous level + refills since − this level − other known use. A rise is flagged. */
export function tankUsage(readings) {
  const rs = [...readings].filter(r => finite(num(r.levelL))).sort((a, b) => new Date(a.at) - new Date(b.at));
  const out = [];
  for (let i = 1; i < rs.length; i++) {
    const used = toMilli(rs[i - 1].levelL) + toMilli(rs[i].addedL ?? 0) - toMilli(rs[i].levelL) - toMilli(rs[i].otherUseL ?? 0);
    out.push(used < 0
      ? { from: rs[i - 1].at, to: rs[i].at, litres: null, status: "UNVERIFIED", note: "The tank rose more than the refills recorded. Was a refill missed?" }
      : { from: rs[i - 1].at, to: rs[i].at, litres: fromMilli(used), status: "MEASURED" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 10. House temperature for the birds' age
// ---------------------------------------------------------------------------------------------------------------
/**
 * Whole-house target temperature for broilers by age, from the Ross broiler management handbook table (at 60-70% relative
 * humidity). Between the listed days the target is interpolated; from day 27 it stays at 20 °C. A guide, not a rule:
 * watch the birds' behaviour.
 */
export const BROILER_TARGET_C = Object.freeze([[0, 30], [3, 28], [6, 27], [9, 26], [12, 25], [15, 24], [18, 23], [21, 22], [24, 21], [27, 20]]);
export function broilerTargetTemp(ageDays) {
  if (!finite(num(ageDays)) || ageDays < 0) return null;
  const t = BROILER_TARGET_C;
  if (ageDays >= t.at(-1)[0]) return { targetC: t.at(-1)[1], source: "Ross broiler handbook, whole-house target" };
  for (let i = 1; i < t.length; i++) {
    if (ageDays <= t[i][0]) {
      const [a0, c0] = t[i - 1], [a1, c1] = t[i];
      return { targetC: Math.round((c0 + ((c1 - c0) * (ageDays - a0)) / (a1 - a0)) * 10) / 10, source: "Ross broiler handbook, whole-house target" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// 11. Growth forecast
// ---------------------------------------------------------------------------------------------------------------
function det3(A) {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}
/** Inverse of a 2×2 or 3×3 matrix; null when it is singular. */
function invSmall(m) {
  if (m.length === 2) {
    const d = m[0][0] * m[1][1] - m[0][1] * m[1][0];
    if (Math.abs(d) < 1e-12) return null;
    return [[m[1][1] / d, -m[0][1] / d], [-m[1][0] / d, m[0][0] / d]];
  }
  const D = det3(m);
  if (Math.abs(D) < 1e-12) return null;
  const c = (r, k) => { const s = m.filter((_, i) => i !== r).map(row => row.filter((_, j) => j !== k)); return (s[0][0] * s[1][1] - s[0][1] * s[1][0]) * ((r + k) % 2 ? -1 : 1); };
  return [0, 1, 2].map(r => [0, 1, 2].map(k => c(k, r) / D));
}

/**
 * Live weight against age from this flock's own weighings: a straight line with 3-4 weighing days, a curve (quadratic)
 * with 5 or more. Gives the weight at a chosen age with a 95% prediction range from how far the weighings sit off the
 * fitted line, and the age the target weight is reached. Never more than 21 days past the last weighing.
 */
export function growthForecast(samples, { atAgeDays = null, targetKg = null, maxAheadDays = 21 } = {}) {
  const pts = samples.filter(s => finite(num(s.ageDays)) && finite(num(s.kg)) && s.kg > 0);
  const ages = new Set(pts.map(p => p.ageDays));
  if (ages.size < 3) return { ok: false, status: "MISSING", note: `Needs birds weighed on at least 3 different days (has ${ages.size}).` };
  const degree = ages.size >= 5 ? 2 : 1, k = degree + 1, n = pts.length;
  const row = a => (degree === 2 ? [1, a, a * a] : [1, a]);
  const XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
  for (const p of pts) { const x = row(p.ageDays); for (let i = 0; i < k; i++) { Xty[i] += x[i] * p.kg; for (let j = 0; j < k; j++) XtX[i][j] += x[i] * x[j]; } }
  const XtXi = invSmall(XtX);
  if (!XtXi) return { ok: false, status: "UNVERIFIED", note: "The weighings are too close together in age to fit a growth curve." };
  const beta = XtXi.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const predict = a => row(a).reduce((s, v, i) => s + v * beta[i], 0);
  const rss = pts.reduce((s, p) => s + (p.kg - predict(p.ageDays)) ** 2, 0);
  const df = n - k, sdRes = df > 0 ? Math.sqrt(rss / df) : null;
  const lastAge = Math.max(...pts.map(p => p.ageDays));
  const r3 = v => Math.round(v * 1000) / 1000;
  const at = a => {
    if (a > lastAge + maxAheadDays) return null;
    const x = row(a);
    const lev = x.reduce((s, xi, i) => s + xi * x.reduce((t, xj, j) => t + XtXi[i][j] * xj, 0), 0);
    const mid = predict(a);
    const half = sdRes != null ? tq(df) * sdRes * Math.sqrt(1 + lev) : null;
    return { ageDays: a, kg: r3(mid), rangeKg: half != null ? [r3(mid - half), r3(mid + half)] : null };
  };
  let reachesTargetAtAge = null;
  if (finite(num(targetKg))) for (let a = lastAge; a <= lastAge + maxAheadDays; a++) if (predict(a) >= targetKg) { reachesTargetAtAge = a; break; }
  return {
    ok: true, status: "FORECAST", model: degree === 2 ? "curve (quadratic)" : "straight line", weighings: n, weighingDays: ages.size, lastWeighedAgeDays: lastAge,
    residualSdKg: sdRes != null ? r3(sdRes) : null,
    atAge: atAgeDays != null ? at(atAgeDays) : null,
    reachesTargetAtAge,
    note: atAgeDays != null && atAgeDays > lastAge + maxAheadDays ? `Too far past the last weighing (day ${lastAge}) to forecast.` : null,
    basis: `Fitted to this flock's ${n} weighings on ${ages.size} days. The range is a 95% prediction range from how far the weighings sit off the ${degree === 2 ? "curve" : "line"}.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 12. Processing outputs: what is food, what is a by-product, what is waste
// ---------------------------------------------------------------------------------------------------------------
export const OUTPUT_KIND = Object.freeze({ CARCASS: "EDIBLE", GIBLET: "EDIBLE", PART: "EDIBLE", FEET: "BYPRODUCT", BYPRODUCT: "BYPRODUCT", WASTE: "WASTE" });

// ---------------------------------------------------------------------------------------------------------------
// 13. Feed units: how feed was counted out → kilograms
// ---------------------------------------------------------------------------------------------------------------
export const POUND_KG = 0.45359237;   // exact, by definition
/**
 * Convert an amount of feed to kg. BAG needs the bag size; MEASURE (scoop, pan, bucket) needs the farm's own
 * kg-per-measure. Nothing is assumed: without the size the answer is "not known", with what to set.
 */
export function feedToKg(quantity, unit, { bagKg = null, measureKg = null, measureName = "measure" } = {}) {
  const q = num(quantity);
  if (!finite(q) || q < 0) return { ok: false, error: "Enter how much feed, as a number of 0 or more." };
  const u = String(unit || "").toUpperCase();
  const r3 = v => fromMilli(toMilli(v));
  if (u === "KG") return { ok: true, kg: r3(q), basis: `${q} kg` };
  if (u === "G") return { ok: true, kg: r3(q / 1000), basis: `${q} g` };
  if (u === "LB") return { ok: true, kg: r3(q * POUND_KG), basis: `${q} lb × 0.4536` };
  if (u === "BAG") {
    if (!finite(num(bagKg)) || bagKg <= 0) return { ok: false, error: "Set the bag size for this feed first (in Settings, Feed, or on the purchase)." };
    return { ok: true, kg: r3(q * bagKg), basis: `${q} bag${q === 1 ? "" : "s"} × ${bagKg} kg` };
  }
  if (u === "MEASURE") {
    if (!finite(num(measureKg)) || measureKg <= 0) return { ok: false, error: `Flockence does not know how much one ${measureName} holds. Weigh one once and enter it in Settings, Feed.` };
    return { ok: true, kg: r3(q * measureKg), basis: `${q} × ${measureName} (${measureKg} kg each)` };
  }
  return { ok: false, error: "Choose bags, kg, grams, pounds or one of your measures." };
}
/** kg back to bags, for showing "12 bags used" next to the kilograms. */
export function kgToBags(kg, bagKg) {
  if (!finite(num(kg)) || !finite(num(bagKg)) || bagKg <= 0) return null;
  return Math.round((kg / bagKg) * 100) / 100;
}
