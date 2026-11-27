export type Layout = { view?: string; feeders?: number | null; drinkers?: number | null; heaters?: number | null; fans?: number | null; crowding?: { at: string; note?: string }[]; emptyAreas?: string[] };
export type Seen = { pictures: number; widePictures: number; feeders: number | null; drinkers: number | null; heaters: number | null; fans: number | null; crowding: Record<string, number>; empty: string[] };
export type PenRecord = { lengthM: number; widthM: number; housingMode: string; feederPans: number; nipples: number; bellDrinkers: number; heatSources: number; fans: number };
export type Recommendation = { priority: number; text: string; basis: string };
export const BASIS: Record<string, string>;
export function summariseSightings(sightings: { layout?: Layout | null }[]): Seen;
export function penLayoutAdvice(input: { pen: PenRecord; live: number; weightKg: number | null; seen: Seen }): {
  areaM2: number | null; densityKgM2: number | null; ceilingKgM2: number | null; live: number | null; weightKg: number | null;
  recorded: { feeders: number | null; nipples: number | null; bellDrinkers: number | null; heaters: number | null; fans: number | null };
  seen: Seen; recommendations: Recommendation[]; notes: string[];
};
