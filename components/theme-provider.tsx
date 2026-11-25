"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeName = "poultry" | "crystal" | "aero" | "heritage" | "workhorse" | "sol" | "terra";
type Density = "comfortable" | "compact";
type Radius = "soft" | "sharp";

type ThemeContextValue = {
  theme: ThemeName;
  freeAppearance: boolean;
  density: Density;
  radius: Radius;
  setTheme: (value: ThemeName) => void;
  setDensity: (value: Density) => void;
  setRadius: (value: Radius) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "flockence-appearance-v3";
const themes: ThemeName[] = ["poultry", "crystal", "aero", "heritage", "workhorse", "sol", "terra"];
const densities: Density[] = ["comfortable", "compact"];
const radii: Radius[] = ["soft", "sharp"];

function isTheme(value: unknown): value is ThemeName { return typeof value === "string" && themes.includes(value as ThemeName); }
function isDensity(value: unknown): value is Density { return typeof value === "string" && densities.includes(value as Density); }
function isRadius(value: unknown): value is Radius { return typeof value === "string" && radii.includes(value as Radius); }

export function ThemeProvider({ children, freeAppearance = false, accountId }: { children: React.ReactNode; freeAppearance?: boolean; accountId?: string }) {
  const [preferredTheme, setPreferredTheme] = useState<ThemeName>("crystal");
  const theme = freeAppearance ? "poultry" : preferredTheme;
  const storageKey = accountId ? STORAGE_KEY + ":" + accountId : STORAGE_KEY;
  const [loaded, setLoaded] = useState(false);
  const [density, setDensity] = useState<Density>("comfortable");
  const [radius, setRadius] = useState<Radius>("soft");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? localStorage.getItem(STORAGE_KEY) ?? "null") as { theme?: unknown; density?: unknown; radius?: unknown } | null;
      if (isTheme(saved?.theme)) setPreferredTheme(saved.theme);
      if (isDensity(saved?.density)) setDensity(saved.density);
      if (isRadius(saved?.radius)) setRadius(saved.radius);
    } catch {
      localStorage.removeItem(storageKey);
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.radius = radius;
    if (loaded) localStorage.setItem(storageKey, JSON.stringify({ theme: preferredTheme, density, radius }));
  }, [theme, preferredTheme, density, radius, loaded, storageKey]);

  const value = useMemo(() => ({ theme, freeAppearance, density, radius, setTheme: (value: ThemeName) => { if (!freeAppearance || value === "poultry") setPreferredTheme(value); }, setDensity, setRadius }), [theme, freeAppearance, density, radius]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
