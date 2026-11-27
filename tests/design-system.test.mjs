import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const nav = read("components/nav.tsx");
const layout = read("app/layout.tsx");

test("navigation keeps every destination from before the redesign", () => {
  const routes = ["/", "/batches", "/operations", "/layers", "/layers/performance", "/layers/packing", "/house", "/pens", "/health",
    "/trace", "/cameras", "/vision", "/devices", "/inventory", "/finances", "/suppliers", "/planning", "/performance", "/reports", "/team", "/settings"];
  for (const route of routes) assert.ok(nav.includes(`"${route}"`), "missing nav route " + route);
});

test("navigation is grouped into the six task groups", () => {
  for (const label of ["Overview", "Daily operations", "Production", "Farm resources", "Insights", "Management"]) {
    assert.ok(nav.includes(`label: "${label}"`), "missing group " + label);
  }
});

test("Team stays limited to owners and supervisors", () => {
  assert.match(nav, /canManage = session\?\.role === "OWNER" \|\| session\?\.role === "MANAGER"/);
  assert.match(nav, /canManage \? \[teamItem\] : \[\]/);
});

test("mobile search and More menu keep their accessible names", () => {
  for (const name of ['aria-label="Search Flockence"', 'aria-label="More destinations"', "Find anything"]) assert.ok(nav.includes(name), name);
});

test("layout loads the self-hosted font and token layers before theme sheets", () => {
  const order = ["@fontsource-variable/manrope", "./styles/tokens.css", "./styles/base.css", "./styles/components.css", "./styles/shell.css", "./crystal.css", "./theme-system.css", "./poultry-refinement.css"];
  const positions = order.map((file) => layout.indexOf(`"${file}"`));
  positions.forEach((position, i) => assert.ok(position > 0, order[i] + " not imported"));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const removed of ["globals.css", "accessibility-theme.css", "premium.css", "premium-fixes.css", "poultry.css", "crystal-depth.css"]) {
    assert.ok(!layout.includes(removed), removed + " is still imported");
  }
});

test("tokens define the brand colours and the 4-32 spacing scale", () => {
  const tokens = read("app/styles/tokens.css");
  for (const [name, hex] of [["forest", "#2e5a12"], ["leaf", "#7cb733"], ["slate", "#232b1c"], ["harvest", "#e0a21e"], ["canvas", "#f5f6f1"]]) {
    assert.ok(tokens.includes(`--brand-${name}: ${hex};`), name);
  }
  const spaces = [...tokens.matchAll(/--space-\d: (\d+)px;/g)].slice(0, 7).map(([, px]) => Number(px));
  assert.deepEqual(spaces, [4, 8, 12, 16, 20, 24, 32]);
});

test("design-system sheets use tokens, not new important overrides or hard-coded theme colours", () => {
  for (const file of ["app/styles/base.css", "app/styles/components.css", "app/styles/shell.css"]) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media print\s*\{[\s\S]*?\n\}/, "");
    const important = (css.match(/!important/g) || []).length;
    // Allowed: reduced-motion reset and the Sol theme blur switch-off in base.css.
    assert.ok(important <= 6, `${file} has ${important} !important`);
  }
});

test("free farms still get only the Poultry Farm theme", () => {
  const provider = read("components/theme-provider.tsx");
  assert.match(provider, /const theme = freeAppearance \? DEFAULT_THEME : preferredTheme;/);
  assert.match(read("lib/theme-registry.ts"), /id: "poultry", name: "Poultry Farm", [^\n]*premium: false/);
});
