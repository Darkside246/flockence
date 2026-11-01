"use client";

import { useState } from "react";
import { useTheme } from "@/components/theme-provider";

const themeLabels = {
  crystal: "Cyber Crystal",
  aero: "Aero Glass",
  heritage: "Heritage Sovereign",
  workhorse: "Field Workhorse",
  sol: "Sol Tactical",
  terra: "Terra Flora"
} as const;

export function AppearanceControl() {
  const [open, setOpen] = useState(false);
  const { theme, density, radius, setTheme, setDensity, setRadius } = useTheme();

  return <div className="appearance-control">
    <button className="appearance-button" type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label="Change appearance">
      <span className="appearance-dot" aria-hidden="true" />
      <span>{themeLabels[theme]}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="appearance-popover" role="dialog" aria-label="Appearance controls">
      <div className="appearance-title">Appearance</div>
      <div className="appearance-copy">Choose a visual operating mode. Farm data does not change.</div>
      <div className="appearance-themes">
        {(Object.keys(themeLabels) as Array<keyof typeof themeLabels>).map(id => <button key={id} type="button" className={theme === id ? "appearance-choice selected" : "appearance-choice"} onClick={() => setTheme(id)} aria-pressed={theme === id}>{themeLabels[id]}{theme === id ? <span aria-hidden="true">✓</span> : null}</button>)}
      </div>
      <div className="appearance-divider" />
      <div className="appearance-label">Density</div>
      <div className="segmented" role="group" aria-label="Density">
        <button type="button" className={density === "comfortable" ? "selected" : ""} onClick={() => setDensity("comfortable")} aria-pressed={density === "comfortable"}>Comfortable</button>
        <button type="button" className={density === "compact" ? "selected" : ""} onClick={() => setDensity("compact")} aria-pressed={density === "compact"}>Compact</button>
      </div>
      <div className="appearance-label">Shape</div>
      <div className="segmented" role="group" aria-label="Shape">
        <button type="button" className={radius === "soft" ? "selected" : ""} onClick={() => setRadius("soft")} aria-pressed={radius === "soft"}>Soft</button>
        <button type="button" className={radius === "sharp" ? "selected" : ""} onClick={() => setRadius("sharp")} aria-pressed={radius === "sharp"}>Sharp</button>
      </div>
    </div>}
  </div>;
}
