// The reference library (Vision Intelligence phase 6, 2026-11-27): what the farm's own guides say for a flock of this
// kind and age, and how today's records compare. Every value carries its source; nothing here is from memory.
// Pure, so it can be tested. Used by the Vision context (so checks judge birds against the right targets), the Farm
// Vision page and reports.
//
// Sources are the guides the owner holds (read 2026-11-27):
//   Cobb Broiler Management Guide (Cobb-Vantress, © 2020)
//   Philip Thomas, "Poultry Rearing: things you should know to improve your production" (Caribbean, Jan 2017)
//   J. R. Gehlot, "Preservation and maintenance of eggs" (Dept. of Livestock Products Technology)
// Not held yet, so not used: Ross handbooks, Hy-Line layer guides, WOAH codes. Add a source here, with its own values,
// when the guide is available.

export const SOURCES = {
  COBB_2020: { id: "COBB_2020", title: "Cobb Broiler Management Guide", publisher: "Cobb-Vantress", year: 2020 },
  THOMAS_2017: { id: "THOMAS_2017", title: "Poultry Rearing: things you should know (Caribbean)", publisher: "Philip Thomas, Poultry Technical Services Consultant", year: 2017 },
  EGGS_GEHLOT: { id: "EGGS_GEHLOT", title: "Preservation and maintenance of eggs", publisher: "Dept. of Livestock Products Technology (J. R. Gehlot)", year: null },
};
export const NOT_HELD = ["Ross broiler handbook", "Hy-Line layer management guides", "WOAH animal welfare codes"];
export const cite = (id) => { const s = SOURCES[id]; return `${s.title}${s.year ? ` (${s.year})` : ""}`; };

// Cobb 2020, "Temperature Recommendation Based on House Relative Humidity" (air temperature, °C), by age in days.
const COBB_RH = [30, 40, 50, 60, 70];
const COBB_AGE_TEMP = { 0: [34, 33, 32, 31, 30], 7: [32, 31, 30, 29, 28], 14: [29, 28, 27, 26, 25] };
// Cobb 2020, "Temperature Guidelines Based on Stocking Density" (°C), for grown birds.
const COBB_DENSITY_TEMP = [[28, 22, 24], [30, 21, 23], [32, 20, 22], [34, 19, 21], [36, 18, 20], [38, 17, 19], [40, 16, 18], [42, 15, 17]];
// Thomas 2017, brooder temperature schedule (°F in the guide; °C here, rounded).
const THOMAS_TEMP = [[1, 7, 32, 33], [8, 14, 29, 31], [15, 21, 27, 29], [22, 28, 24, 26], [29, 35, 21, 23], [36, 999, 20, 21]];

const r1 = (x) => Math.round(x * 10) / 10;

/** Cobb's target air temperature for this age and house humidity (interpolated between the guide's columns). */
export function cobbTargetC(ageDays, rh = 60) {
  const band = ageDays < 7 ? 0 : ageDays < 14 ? 7 : ageDays < 21 ? 14 : null;
  if (band == null) return null;
  const row = COBB_AGE_TEMP[band];
  const h = Math.min(70, Math.max(30, rh ?? 60));
  const i = Math.min(3, Math.floor((h - 30) / 10));
  return r1(row[i] + (row[i + 1] - row[i]) * ((h - COBB_RH[i]) / 10));
}

/** Cobb's temperature range for grown birds at this stocking density (kg/m²). */
export function cobbDensityRangeC(density) {
  if (!(density > 0)) return null;
  const row = COBB_DENSITY_TEMP.find(([d]) => density <= d) ?? [42, 14, 16];
  return [row[1], row[2]];
}

/** Thomas's brooding range for this age. */
export function thomasRangeC(ageDays) {
  const day = Math.max(1, ageDays);
  const row = THOMAS_TEMP.find(([a, b]) => day >= a && day <= b);
  return row ? [row[2], row[3]] : null;
}

/**
 * The guidance for a flock: [{topic, text, source}]. flock: {kind: "broiler"|"layer", ageDays, rh, densityKgM2,
 * naturalVentilation}. Only what the held guides cover for this kind and age.
 */
export function guidanceFor({ kind = "broiler", ageDays = 0, rh = null, densityKgM2 = null, naturalVentilation = true }) {
  const out = [];
  const add = (topic, text, source) => out.push({ topic, text, source: cite(source) });
  if (kind === "broiler") {
    const cobb = cobbTargetC(ageDays, rh ?? 60);
    if (cobb != null) add("Temperature", `about ${cobb} °C air temperature at day ${ageDays}${rh != null ? ` with ${Math.round(rh)}% humidity` : " (at 60% humidity; higher humidity needs a little less heat)"}; birds should never huddle`, "COBB_2020");
    const density = densityKgM2 != null && ageDays >= 21 ? cobbDensityRangeC(densityKgM2) : null;
    if (density) add("Temperature", `${density[0]}–${density[1]} °C for grown birds at about ${Math.round(densityKgM2)} kg/m²`, "COBB_2020");
    const thomas = thomasRangeC(ageDays);
    if (thomas) add("Temperature", `${thomas[0]}–${thomas[1]} °C for day ${ageDays} on the Caribbean brooding schedule (reduce about 2 °C a week)`, "THOMAS_2017");
    add("Litter", "keep litter moisture below 35% (it should fall apart when squeezed); remove caked and wet litter daily; 3–4 inches (8–10 cm) deep", "COBB_2020");
    add("Air", "ammonia below 25 ppm and carbon dioxide below 3,000 ppm", "COBB_2020");
    if (naturalVentilation) add("Space", "at least 1.5 sq ft (0.14 m²) per bird in naturally ventilated houses, 1.7–1.8 sq ft (0.16–0.17 m²) in hot months", "THOMAS_2017");
    add("Space", "above 28 kg/m² watch behaviour, feed intake and bird temperature closely; never above 42 kg/m²", "COBB_2020");
    add("Feeders and drinkers", "45–65 birds per 33 cm feeder pan; 12 birds per high-flow nipple or 10 per low-flow nipple", "COBB_2020");
    if (ageDays <= 14) add("Feeders and drinkers", "at least one 1-gallon fountain per 100 chicks, filled before they arrive", "THOMAS_2017");
    add("Feed", ageDays <= 28 ? "broiler crumble to day 28, then pellets" : "broiler pellets from day 29 to market", "THOMAS_2017");
    add("Light", ageDays <= 7 ? "at least 25 lux in the darkest part of the house at the start" : "light may be reduced gradually to 5–10 lux; keep it even (within 20%)", "COBB_2020");
  }
  if (kind === "layer") {
    add("Eggs", "collect eggs 3–4 times a day; hold them at about 15 °C and 70–80% humidity; pack broad end up", "EGGS_GEHLOT");
  }
  return out;
}

/**
 * Today's records against the guidance: [{topic, level: "OK"|"CHECK", text, source}]. Only facts that were recorded.
 * now: {kind, ageDays, tempC, rh, ammoniaPpm, densityKgM2, litter, m2PerBird}
 */
export function checkAgainstGuidance(now) {
  const out = [];
  const flag = (topic, ok, text, source) => out.push({ topic, level: ok ? "OK" : "CHECK", text, source: cite(source) });
  if (now.kind === "broiler" && Number.isFinite(now.tempC)) {
    const target = cobbTargetC(now.ageDays, now.rh ?? 60);
    const range = target != null ? [target - 1, target + 1] : now.densityKgM2 ? cobbDensityRangeC(now.densityKgM2) : null;
    if (range) {
      const ok = now.tempC >= range[0] && now.tempC <= range[1];
      flag("Temperature", ok, `${now.tempC} °C recorded; the guide's target is ${target != null ? `about ${target}` : `${range[0]}–${range[1]}`} °C${ok ? "" : now.tempC < range[0] ? ": too cold for their age, watch for huddling" : ": too warm, watch for panting and wings held out"}`, "COBB_2020");
    }
  }
  if (Number.isFinite(now.ammoniaPpm)) flag("Air", now.ammoniaPpm < 25, `ammonia ${now.ammoniaPpm} ppm recorded; keep it below 25 ppm`, "COBB_2020");
  if (now.kind === "broiler" && Number.isFinite(now.densityKgM2)) flag("Space", now.densityKgM2 <= 28, `about ${r1(now.densityKgM2)} kg/m²${now.densityKgM2 > 42 ? ": above the 42 kg/m² limit" : now.densityKgM2 > 28 ? ": above 28 kg/m², watch the birds closely" : ""}`, "COBB_2020");
  if (now.kind === "broiler" && Number.isFinite(now.m2PerBird)) flag("Space", now.m2PerBird >= 0.14, `about ${r1(now.m2PerBird * 10.764)} sq ft per bird; at least 1.5 sq ft (1.7–1.8 in hot months) in naturally ventilated houses`, "THOMAS_2017");
  if (typeof now.litter === "string" && now.litter) flag("Litter", !/wet|cake|damp/i.test(now.litter), `litter recorded as ${now.litter.toLowerCase()}; keep moisture below 35% and remove caked or wet litter daily`, "COBB_2020");
  return out;
}
