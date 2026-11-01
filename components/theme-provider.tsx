"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemeName = "crystal" | "aero" | "heritage" | "workhorse" | "sol" | "terra";
type Density = "comfortable" | "compact";
type Radius = "soft" | "sharp";

type ThemeContextValue = {
  theme: ThemeName;
  density: Density;
  radius: Radius;
  setTheme: (value: ThemeName) => void;
  setDensity: (value: Density) => void;
  setRadius: (value: Radius) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "flockence-appearance-v3";
const themes: ThemeName[] = ["crystal", "aero", "heritage", "workhorse", "sol", "terra"];
const densities: Density[] = ["comfortable", "compact"];
const radii: Radius[] = ["soft", "sharp"];

function isTheme(value: unknown): value is ThemeName { return typeof value === "string" && themes.includes(value as ThemeName); }
function isDensity(value: unknown): value is Density { return typeof value === "string" && densities.includes(value as Density); }
function isRadius(value: unknown): value is Radius { return typeof value === "string" && radii.includes(value as Radius); }

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>("crystal");
  const [density, setDensity] = useState<Density>("comfortable");
  const [radius, setRadius] = useState<Radius>("soft");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { theme?: unknown; density?: unknown; radius?: unknown } | null;
      if (isTheme(saved?.theme)) setTheme(saved.theme);
      if (isDensity(saved?.density)) setDensity(saved.density);
      if (isRadius(saved?.radius)) setRadius(saved.radius);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.radius = radius;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, density, radius }));
  }, [theme, density, radius]);

  const value = useMemo(() => ({ theme, density, radius, setTheme, setDensity, setRadius }), [theme, density, radius]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
