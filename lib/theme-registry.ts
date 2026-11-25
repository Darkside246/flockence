export const DEFAULT_THEME = "poultry";

export const themes = [
  { id: "poultry", name: "Poultry Farm", description: "Bright, natural workspaces for daily farm operations.", premium: false },
  { id: "crystal", name: "Cyber Crystal", description: "Obsidian surfaces with crisp teal and ice blue.", premium: true },
  { id: "aero", name: "Aero Glass", description: "Layered slate, sky blue and soft periwinkle.", premium: true },
  { id: "heritage", name: "Heritage Sovereign", description: "Estate greens with warm brass details.", premium: true },
  { id: "workhorse", name: "Field Workhorse", description: "Solid charcoal, amber controls and clear readouts.", premium: true },
  { id: "sol", name: "Sol Tactical", description: "High-contrast black with sharp solar accents.", premium: true },
  { id: "terra", name: "Terra Flora", description: "Earthy charcoal with botanical green and clay accents.", premium: true },
] as const;

export type ThemeName = (typeof themes)[number]["id"];
export const themeIds = themes.map(({ id }) => id);
