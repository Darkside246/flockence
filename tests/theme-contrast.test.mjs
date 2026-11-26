import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/theme-system.css", import.meta.url), "utf8");
const palettes = [...css.matchAll(/\.theme-preview\[data-theme="([^"]+)"\] \{([^}]+)\}/g)];
const readColors = (rules) => Object.fromEntries([...rules.matchAll(/--([\w-]+): #([\da-f]{6});/gi)].map(([, key, hex]) => [key, hex]));
function luminance(hex) {
  assert.match(hex, /^[\da-f]{6}$/i);
  return hex.match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
}
function ratio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
const text = ["text-primary", "text-secondary", "text-muted"];
const surfaces = ["bg-canvas", "bg-surface", "bg-surface-secondary", "bg-surface-elevated"];
const pairs = [
  ...text.flatMap((foreground) => surfaces.map((background) => [foreground, background, 4.5])),
  ...["accent-primary", "accent-primary-hover"].map((bg) => ["accent-contrast", bg, 4.5]),
  ...["bg-surface", "accent-soft"].map((bg) => ["accent-primary", bg, 4.5]),
  ...["status-success", "status-warning", "status-danger", "status-info"].map((fg) => [fg, "bg-surface", 4.5]),
  ...["border-strong", "border-focus"].flatMap((fg) => ["bg-surface", "bg-surface-elevated"].map((bg) => [fg, bg, 3])),
];

test("all seven themes provide individually validated palettes", () => {
  assert.deepEqual(palettes.map(([, id]) => id), ["poultry", "crystal", "aero", "heritage", "workhorse", "sol", "terra"]);
});
for (const [, id, rules] of palettes) {
  test(id + " contrast meets the semantic palette's AA thresholds", () => {
    const colors = readColors(rules);
    for (const [fg, bg, minimum] of pairs) {
      const contrast = ratio(colors[fg], colors[bg]);
      assert.ok(contrast >= minimum, `${fg} on ${bg}: ${contrast.toFixed(2)} (minimum ${minimum})`);
    }
  });
}
