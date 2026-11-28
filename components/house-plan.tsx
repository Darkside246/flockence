/**
 * The "Recommended layout" strip on House and Pens: lanes across the house, each shown with its
 * first letter as a bold badge followed by the rest of the word ("[F]eed", "[W]ater lane"), so the
 * letter and the word read as one (owner, 27 Nov 2026). Screen readers hear the plain label.
 */
export type PlanLane = { kind: "feed" | "water" | "space" | "air"; label: string };

export function HousePlan({ lanes, label = "Recommended layout" }: { lanes: readonly PlanLane[]; label?: string }) {
  return <ul className="house-plan" aria-label={label}>
    {lanes.map((lane, index) => <li key={index} className={`house-cell ${lane.kind}`} aria-label={lane.label}>
      <b aria-hidden="true">{lane.label.slice(0, 1)}</b><span aria-hidden="true">{lane.label.slice(1)}</span>
    </li>)}
  </ul>;
}
