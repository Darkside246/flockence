"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";

import { DEFAULT_THEME, themeIds, type ThemeName } from "@/lib/theme-registry";
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
const ACTIVE_KEY = "flockence-active-appearance";
const densities: Density[] = ["comfortable", "compact"];
const radii: Radius[] = ["soft", "sharp"];

function isTheme(value: unknown): value is ThemeName { return typeof value === "string" && themeIds.includes(value as ThemeName); }
function isDensity(value: unknown): value is Density { return typeof value === "string" && densities.includes(value as Density); }
function isRadius(value: unknown): value is Radius { return typeof value === "string" && radii.includes(value as Radius); }

export function ThemeProvider({ children, freeAppearance = false, accountId }: { children: React.ReactNode; freeAppearance?: boolean; accountId?: string }) {
  const [preferredTheme, setPreferredTheme] = useState<ThemeName>(DEFAULT_THEME);
  const theme = freeAppearance ? DEFAULT_THEME : preferredTheme;
  const storageKey = accountId ? STORAGE_KEY + ":" + accountId : STORAGE_KEY;
  const [loaded, setLoaded] = useState(false);
  const [density, setDensity] = useState<Density>("comfortable");
  const [radius, setRadius] = useState<Radius>("soft");

  useLayoutEffect(() => {
    try {
      const saved = JSON.parse(((accountId ? localStorage.getItem(storageKey) : localStorage.getItem(ACTIVE_KEY)) ?? localStorage.getItem(STORAGE_KEY) ?? "null")) as { theme?: unknown; density?: unknown; radius?: unknown } | null;
      if (isTheme(saved?.theme)) setPreferredTheme(saved.theme);
      if (isDensity(saved?.density)) setDensity(saved.density);
      if (isRadius(saved?.radius)) setRadius(saved.radius);
    } catch {
      // Use defaults when storage is unavailable or the preference is invalid.
    }
    setLoaded(true);
  }, [accountId, storageKey]);

  useLayoutEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.radius = radius;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ theme: preferredTheme, density, radius }));
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({ theme, density, radius }));
    } catch { /* Appearance still works when browser storage is disabled. */ }
  }, [theme, preferredTheme, density, radius, loaded, storageKey]);

  const value = useMemo(() => ({ theme, freeAppearance, density, radius, setTheme: (value: ThemeName) => { if (!freeAppearance || value === DEFAULT_THEME) setPreferredTheme(value); }, setDensity, setRadius }), [theme, freeAppearance, density, radius]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
