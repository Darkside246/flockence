import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NAV, ALIASES, canSee, locate, pathOf, siblings } from "../lib/nav-config.ts";

const items = NAV.flatMap(category => category.items);

test("every destination is unique and has a page", () => {
  const seen = new Set();
  for (const item of items) {
    assert.ok(!seen.has(item.href), `duplicate destination ${item.href}`);
    seen.add(item.href);
    const base = pathOf(item.href);
    const page = base === "/" ? "app/page.tsx" : `app${base}/page.tsx`;
    assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), `${item.href} has no ${page}`);
  }
});

test("old addresses redirect to a real destination and are wired in next.config.mjs", () => {
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  for (const [from, to] of Object.entries(ALIASES)) {
    assert.ok(items.some(item => pathOf(item.href) === to), `${from} points at ${to}, which is not in the navigation`);
    assert.ok(config.includes(`"${from}"`), `${from} is missing from next.config.mjs`);
  }
});

test("a page belongs to one category and the longest address wins", () => {
  assert.equal(locate("/layers/packing")?.item.label, "Egg Packing");
  assert.equal(locate("/layers")?.item.label, "Layer Production");
  assert.equal(locate("/daily-round")?.category.id, "workspace");
  assert.equal(locate("/health")?.category.id, "farm");
  assert.equal(locate("/nowhere"), null);
});

test("Team is for owners and managers only; Settings is for everyone", () => {
  const team = items.find(item => item.label === "Team");
  const settings = items.find(item => item.label === "Settings");
  assert.equal(canSee(team, "OWNER"), true);
  assert.equal(canSee(team, "MANAGER"), true);
  assert.equal(canSee(team, "WORKER"), false);
  assert.equal(canSee(team, "READ_ONLY"), false);
  assert.equal(canSee(team, null), false);
  assert.equal(canSee(settings, "READ_ONLY"), true);
  assert.deepEqual(siblings("/settings", "WORKER").map(item => item.label), ["Settings"]);
});
