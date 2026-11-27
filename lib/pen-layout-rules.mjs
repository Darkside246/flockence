// Pen size and layout advice (Vision Intelligence plan, section 5; 2026-11-27). Pure, so it can be tested.
//
// A camera cannot measure a pen by itself, so the size always comes from the farm's own records (Pens page or farm
// setup). Vision adds what it actually saw: the feeders, drinkers and heaters in view, and where birds crowd or stay
// away. The advice compares the records, what was seen and what the bird numbers need, and names the guidance it uses.
// It never changes the farm's records.

export const BASIS = {
  stocking: "Ross Broiler Management Handbook (stocking density ceilings by housing)",
  feeders: "Cobb Broiler Management Guide (45–65 birds per feeder pan)",
  nipples: "Ross Broiler Pocket Guide (9–12 birds per nipple)",
  bells: "Ross Broiler Pocket Guide (about 1 bell drinker per 80–100 birds)",
  behaviour: "What the cameras showed over the last 7 days",
};
const CEILING = { CONTROLLED: 30, OPEN_SIDED_GOOD: 25, OPEN_SIDED_HOT: 18 };
const HOUSING = { CONTROLLED: "controlled-environment", OPEN_SIDED_GOOD: "open-sided, well ventilated", OPEN_SIDED_HOT: "open-sided, hot" };
const BIRDS_PER_BELL = 90;
const round1 = (x) => Math.round(x * 10) / 10;

/** The most of each piece of equipment seen in one picture that showed (most of) the pen, and repeated crowding. */
export function summariseSightings(sightings) {
  const wide = sightings.filter((s) => s.layout && (s.layout.view === "WHOLE_PEN" || s.layout.view === "MOST_OF_PEN"));
  const most = (k) => { const v = wide.map((s) => s.layout[k]).filter((n) => Number.isInteger(n)); return v.length ? Math.max(...v) : null; };
  const crowding = {};
  for (const s of sightings) for (const c of new Set((s.layout?.crowding ?? []).map((c) => c.at))) crowding[c] = (crowding[c] ?? 0) + 1;
  const empty = [...new Set(sightings.flatMap((s) => s.layout?.emptyAreas ?? []))].slice(0, 4);
  return { pictures: sightings.filter((s) => s.layout).length, widePictures: wide.length, feeders: most("feeders"), drinkers: most("drinkers"), heaters: most("heaters"), fans: most("fans"), crowding, empty };
}

/**
 * Advice for one pen. pen: the saved pen record (metres; equipment counts, 0 meaning not entered). live: birds in the
 * pen from the flock records. weightKg: latest average live weight (null if none recorded). seen: summariseSightings().
 */
export function penLayoutAdvice({ pen, live, weightKg, seen }) {
  const recs = [];
  const notes = [];
  const add = (priority, text, basis) => recs.push({ priority, text, basis });
  const area = pen.lengthM > 0 && pen.widthM > 0 ? round1(pen.lengthM * pen.widthM) : null;
  const housing = CEILING[pen.housingMode] ? pen.housingMode : "OPEN_SIDED_HOT";
  const ceiling = CEILING[housing];

  if (!area) add(1, "Enter this pen's length and width on the Pens page. Vision cannot measure a pen from pictures, so without them there is no space advice.", "Farm records");
  let density = null;
  if (area && live > 0) {
    if (weightKg > 0) {
      density = round1((live * weightKg) / area);
      if (density > ceiling) add(1, `Stocking is about ${density} kg/m², above the ${ceiling} kg/m² ceiling for ${HOUSING[housing]} housing. Move about ${Math.ceil(live - (ceiling * area) / weightKg)} birds or give them more floor.`, BASIS.stocking);
      else if (density > ceiling * 0.9) add(2, `Stocking is about ${density} kg/m², close to the ${ceiling} kg/m² ceiling. Plan where birds go as they grow.`, BASIS.stocking);
    } else notes.push("No recent weight is recorded for this flock, so stocking density (kg/m²) cannot be worked out. Record a weigh-in.");
    notes.push(`${area} m² for ${live} birds: about ${Math.round((area / live) * 100) / 100} m² per bird.`);
  }

  // Feeders: the records, or what Vision saw when nothing was entered.
  const feedersRecorded = pen.feederPans > 0 ? pen.feederPans : null;
  const feeders = feedersRecorded ?? seen.feeders;
  if (live > 0) {
    const need = Math.ceil(live / 65), comfortable = Math.ceil(live / 45);
    if (feeders == null) add(2, `Enter the number of feeders on the Pens page (about ${need}–${comfortable} pans for ${live} birds). The cameras have not shown the whole pen yet.`, BASIS.feeders);
    else if (feeders < need) add(1, `Add about ${need - feeders} feeder pan${need - feeders === 1 ? "" : "s"}: ${feeders} ${feedersRecorded ? "recorded" : "seen"} for ${live} birds, and ${need}–${comfortable} are needed.`, BASIS.feeders);
  }

  // Drinkers: nipples (9–12 birds each, fewer for heavy birds) or bell drinkers.
  if (live > 0) {
    const perNipple = weightKg > 3 ? 9 : 12;
    const capacity = (pen.nipples > 0 ? pen.nipples * perNipple : 0) + (pen.bellDrinkers > 0 ? pen.bellDrinkers * BIRDS_PER_BELL : 0);
    if (capacity > 0 && capacity < live) {
      const short = live - capacity;
      add(1, `Add drinking space for about ${short} more birds: about ${Math.ceil(short / perNipple)} more nipples, or ${Math.ceil(short / BIRDS_PER_BELL)} more bell drinker${Math.ceil(short / BIRDS_PER_BELL) === 1 ? "" : "s"}.`, pen.nipples > 0 ? BASIS.nipples : BASIS.bells);
    } else if (capacity === 0) add(2, `Enter the drinkers on the Pens page (about ${Math.ceil(live / perNipple)} nipples, or ${Math.ceil(live / BIRDS_PER_BELL)} bell drinkers, for ${live} birds).`, BASIS.nipples);
  }

  // Seen against recorded, only from pictures that showed (most of) the pen.
  if (seen.widePictures > 0) {
    if (feedersRecorded && seen.feeders != null && seen.feeders < feedersRecorded) add(3, `The cameras showed at most ${seen.feeders} feeder${seen.feeders === 1 ? "" : "s"}, but ${feedersRecorded} are recorded. Check whether some are out of view, empty or removed, and update the Pens page if needed.`, BASIS.behaviour);
    if (pen.heatSources > 0 && seen.heaters != null && seen.heaters < pen.heatSources) add(3, `The cameras showed ${seen.heaters} heater${seen.heaters === 1 ? "" : "s"}, but ${pen.heatSources} are recorded. Check they are all in place and working.`, BASIS.behaviour);
  } else if (seen.pictures > 0) notes.push("No picture has shown the whole pen yet, so equipment counts from the cameras are partial.");

  // Behaviour repeated across pictures says more about the layout than any single picture.
  const twice = (k) => (seen.crowding[k] ?? 0) >= 2;
  if (twice("FEEDER")) add(2, "Birds crowded at the feeders in several pictures. Add feeder space or spread the feeders more evenly along the pen.", BASIS.behaviour);
  if (twice("DRINKER")) add(2, "Birds crowded at the drinkers in several pictures. Check water flow and drinker height, and add or spread drinkers.", BASIS.behaviour);
  if (twice("HEATER")) add(2, "Birds bunched around the heat in several pictures, a sign they are cold. Check brooding temperature at bird height for their age, and draughts.", BASIS.behaviour);
  if (twice("WALL") || twice("CORNER")) add(2, "Birds packed against walls or corners in several pictures. Look for draughts, direct sun, wet litter or uneven light, and keep feed and water away from the hottest spots.", BASIS.behaviour);
  if (seen.empty.length) add(3, `Birds stayed away from: ${seen.empty.join("; ")}. Check those areas for wet litter, draughts, heat or light.`, BASIS.behaviour);

  recs.sort((a, b) => a.priority - b.priority);
  return {
    areaM2: area, densityKgM2: density, ceilingKgM2: area ? ceiling : null, live: live || null, weightKg: weightKg || null,
    recorded: { feeders: feedersRecorded, nipples: pen.nipples || null, bellDrinkers: pen.bellDrinkers || null, heaters: pen.heatSources || null, fans: pen.fans || null },
    seen, recommendations: recs, notes,
  };
}
