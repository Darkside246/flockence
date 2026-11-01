import type { ReactNode } from "react";

/** Small line-icon set for the Flockence dashboard. 16x16 grid, 1.5 stroke, inherits currentColor. */
const paths: Record<string, ReactNode> = {
  plus: <path d="M8 3v10M3 8h10" />,
  bird: <><path d="M3 10c0-3 2-5.5 5-5.5 2.3 0 4 1.2 5 3.2V10H9.2L8 13H5.2v-3H3Z" /><circle cx="10.3" cy="6.4" r=".5" fill="currentColor" /></>,
  eggs: <><path d="M8 2.2c-2.2 0-4.6 3.8-4.6 7.1A4.6 4.6 0 0 0 8 13.8a4.6 4.6 0 0 0 4.6-4.5C12.6 6 10.2 2.2 8 2.2Z" /><path d="M6.2 9.5c.1 1.1.7 1.7 1.8 2" /></>,
  flock: <><path d="M4 11c0-3 1.8-5 4.5-5S13 8 13 11" /><path d="M5 11v3M11 11v3M3 14h10" /><circle cx="8.5" cy="4" r="1.4" /></>,
  pulse: <path d="M1.5 8h3l1.6-4 3 8 1.9-4h3.5" />,
  money: <><rect x="2" y="4" width="12" height="8" rx="1.5" /><circle cx="8" cy="8" r="2" /></>,
  gauge: <><path d="M2.5 11a5.5 5.5 0 1 1 11 0" /><path d="m8 11 2.4-3.4" /><circle cx="8" cy="11" r=".6" fill="currentColor" /></>,
  feed: <><path d="M3 5h10v7H3z" /><path d="M5 3h6v2H5zM5 12v2M11 12v2" /></>,
  package: <><path d="M2.5 5 8 2l5.5 3v6L8 14l-5.5-3z" /><path d="m2.5 5 5.5 3 5.5-3M8 8v6" /></>,
  camera: <><rect x="2" y="4.5" width="8" height="7" rx="1.5" /><path d="m10 7.5 4-2v5l-4-2z" /></>,
  leaf: <path d="M3 13C3 7 7 3 13 3c0 6-4 10-10 10Zm0 0 5-5" />,
};

export function CxIcon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.bird}</svg>;
}
