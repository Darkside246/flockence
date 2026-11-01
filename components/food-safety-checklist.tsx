"use client";

import { useEffect, useMemo, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type Check = {
  id: string;
  label: string;
  detail: string;
};

type Group = {
  title: string;
  checks: Check[];
};

const groups: Group[] = [
  {
    title: "Food handlers",
    checks: [
      { id: "handler-fitness", label: "Food handlers meet the farm's applicable health and local regulatory requirements before handling exposed food.", detail: "Use the site's approved health/medical process and keep required evidence available for inspection." },
      { id: "personal-cleanliness", label: "Hands, clothing and exposed skin are clean before food handling.", detail: "Handwashing must happen at the appropriate times, including after toilet use and after activities that could contaminate hands." },
      { id: "hair-cover", label: "Hair and facial hair are controlled as required by the food-handling area.", detail: "Keep loose hair and other physical contaminants away from exposed food." },
      { id: "wounds-covered", label: "Cuts, wounds and abrasions are properly covered before food handling.", detail: "Use a clean, waterproof covering and follow the farm's exclusion rules for infected wounds." },
      { id: "no-contamination-behaviour", label: "No smoking, eating, chewing gum, spitting or similar contamination risks in food handling areas.", detail: "Protect exposed food from people-related contamination." },
    ],
  },
  {
    title: "Water, cleaning and sanitation",
    checks: [
      { id: "water-fit", label: "Water used for food handling and cleaning is fit for its intended purpose.", detail: "Keep the farm's water source and treatment controls documented where required." },
      { id: "hand-stations", label: "Handwashing stations are usable and stocked.", detail: "Confirm water, soap and the required hand-drying method are available before the round." },
      { id: "food-contact-clean", label: "Food-contact surfaces, tools and equipment are visibly clean and sanitised according to the farm SOP.", detail: "Use the approved chemical, concentration, contact time and verification method for the site." },
      { id: "chemicals-controlled", label: "Cleaning chemicals are identified, separated from food and stored safely.", detail: "Follow label instructions and the farm's chemical-control procedure." },
      { id: "preop-check", label: "The processing area passes the pre-operation hygiene check before food production starts.", detail: "Do not rely on yesterday's clean-down as proof of today's readiness." },
    ],
  },
  {
    title: "Cross-contamination controls",
    checks: [
      { id: "live-vs-processed", label: "Live-bird, dirty and raw handling activities are physically or operationally separated from clean/processed product.", detail: "Control people, tools, containers and traffic so contamination does not move into clean areas." },
      { id: "dedicated-tools", label: "Tools, containers and work surfaces are controlled so contaminated equipment is not reused in clean processing without the required cleaning step.", detail: "Use dedicated equipment where the farm SOP calls for it." },
      { id: "condemned-segregated", label: "Condemned material and waste are clearly identified and kept out of saleable product flow.", detail: "Maintain the reason and disposition in the operational record." },
      { id: "packaging-protected", label: "Clean packaging is protected from dirt, pests, splash and other contamination before use.", detail: "Packaging should enter the clean process in a condition that protects the product." },
      { id: "worker-flow", label: "Worker and equipment movement follows the farm's clean-to-dirty control plan.", detail: "Correct uncontrolled movement before production continues." },
    ],
  },
  {
    title: "Harvest, processing and cold chain",
    checks: [
      { id: "withdrawal-release", label: "Veterinary treatment withdrawal status is checked before birds, eggs or products are released for sale.", detail: "Use the recorded treatment and clearance data in Flockence. Do not substitute a generic waiting period." },
      { id: "chilling-recorded", label: "Actual product chilling/storage conditions are recorded and compared with the site's configured limits.", detail: "Flockence records observed temperatures. The farm's approved limits and competent authority requirements control the decision." },
      { id: "deviation-action", label: "Any temperature or handling deviation has a documented disposition before affected product is released.", detail: "Hold, assess and disposition affected lots according to the approved food-safety procedure." },
      { id: "traceability", label: "Each released product lot can be traced to the flock, slaughter/processing event and storage or sales record.", detail: "Use batch, slaughter event, lot code and inventory records rather than handwritten memory." },
      { id: "labels", label: "Product labels and packaging carry the information required by the farm's approved process and applicable law.", detail: "Do not assume one label format is legal in every market." },
    ],
  },
  {
    title: "HACCP / verification",
    checks: [
      { id: "hazards-reviewed", label: "The farm has identified relevant biological, chemical and physical hazards for its process.", detail: "Review the hazard analysis whenever the process, equipment, product or intended market changes." },
      { id: "controls-defined", label: "Site-specific control measures, critical limits where applicable, monitoring and corrective actions are documented.", detail: "Codex HACCP is process-specific. Flockence should record evidence, not invent a HACCP plan." },
      { id: "records-verified", label: "Today’s food-safety records are reviewed for completeness and unusual results.", detail: "A completed checkbox is not a substitute for verification of the underlying measurement or observation." },
      { id: "corrective-actions", label: "Any failed check has an owner, corrective action and follow-up.", detail: "Do not simply tick a failed control complete without resolving the underlying problem." },
    ],
  },
];

export function FoodSafetyChecklist() {
  const roundDate = calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
  const storageKey = `chicken-op.food-safety.${roundDate}`;
  const [complete, setComplete] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setComplete(parsed);
      }
    } catch {
      // A local checklist remains usable even when browser storage is unavailable.
    } finally {
      setLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(complete));
    } catch {
      // Do not make a farm round fail because browser storage is unavailable.
    }
  }, [complete, loaded, storageKey]);
  const total = groups.reduce((sum, group) => sum + group.checks.length, 0);
  const done = Object.values(complete).filter(Boolean).length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  const incomplete = useMemo(
    () => groups.flatMap(group => group.checks.filter(check => !complete[check.id])),
    [complete],
  );

  return (
    <section className="section card">
      <div className="section-head">
        <div>
          <div className="hero-kicker">Food safety round</div>
          <h2>Before food leaves the farm</h2>
          <p>Use this as a practical pre-operation and release checklist. It is guidance, not a legal compliance certificate or substitute for the farm's approved SOPs, HACCP plan or competent-authority requirements.</p>
        </div>
        <span className="badge">{progress}% COMPLETE</span>
      </div>

      <div className="stats">
        <div><span>Checks complete</span><strong>{done} / {total}</strong></div>
        <div><span>Still open</span><strong>{incomplete.length}</strong></div>
        <div><span>Decision basis</span><strong>Recorded evidence</strong></div>
        <div><span>Release rule</span><strong>Follow site SOP</strong></div>
      </div>

      <div className="list" style={{ marginTop: 16 }}>
        {groups.map(group => (
          <div className="card" key={group.title}>
            <div className="section-head">
              <div><h3>{group.title}</h3><p className="muted">{group.checks.length} checks</p></div>
              <span className="badge">{group.checks.filter(check => complete[check.id]).length}/{group.checks.length}</span>
            </div>
            <div className="list">
              {group.checks.map(check => (
                <label className="card row" key={check.id} style={{ cursor: "pointer" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(complete[check.id])}
                      onChange={event => setComplete(current => ({ ...current, [check.id]: event.target.checked }))}
                      aria-label={check.label}
                    />
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {incomplete.length === 0
        ? <p className="notice" role="status">All checklist items are marked complete for this working round. Confirm the underlying records and site procedures before releasing product.</p>
        : <p className="notice notice-danger" role="status">{incomplete.length} checklist item{incomplete.length === 1 ? "" : "s"} remain open. Resolve the control or document the approved corrective action before release.</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button className="button" type="button" onClick={() => { setComplete({}); try { window.localStorage.removeItem(storageKey); } catch {} }}>Reset round</button>
        <a className="button" href="/inventory">Review cold-chain and stock records</a>
        <a className="button" href="/health">Review health and treatment records</a>
      </div>

      <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Reference framework: Codex General Principles of Food Hygiene (CXC 1-1969), including GHP and HACCP principles; the 2026 Codex revision to the guidelines for Campylobacter and Salmonella control in chicken meat; and Barbados food-hygiene requirements for food handlers. Local law, approved procedures and competent-authority instructions take precedence. This browser checklist is a convenience aid and is not the farm's official food-safety record.
      </p>
    </section>
  );
}
