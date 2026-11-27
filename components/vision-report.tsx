"use client";

/**
 * A saved Farm Vision report, readable in full. The note is stored as short sections ("Summary: ...",
 * "Observations:\n...", "- item" lines); each section becomes a heading with its text or list.
 */
export function VisionReport({ text }: { text: string }) {
  const sections = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return <div className="vision-report">
    {sections.map((block, i) => {
      const lines = block.split("\n");
      const head = lines[0];
      const colon = head.indexOf(":");
      const title = colon > 0 && colon < 60 ? head.slice(0, colon) : "";
      const rest = title ? [head.slice(colon + 1).trim(), ...lines.slice(1)].filter(Boolean) : lines;
      const bullets = rest.filter((l) => l.startsWith("- "));
      const plain = rest.filter((l) => !l.startsWith("- "));
      return <section key={i}>
        {title && <h4>{title}</h4>}
        {plain.map((l, j) => <p key={j}>{l}</p>)}
        {bullets.length > 0 && <ul>{bullets.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>}
      </section>;
    })}
  </div>;
}
