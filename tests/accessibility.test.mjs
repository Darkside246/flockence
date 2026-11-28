// Accessibility guard (28 Nov 2026): the basics a keyboard or screen-reader user needs, checked in the source so they
// do not quietly regress. Colour contrast is covered by tests/theme-contrast.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : files(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}
const sources = [...files(path.join(root, "app")), ...files(path.join(root, "components"))].map((file) => ({ file: path.relative(root, file), text: readFileSync(file, "utf8") }));

/** JSX opening tags of one element, read with brace depth so `=>` inside a handler does not end the tag. */
function openingTags(text, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b`, "g");
  for (let m; (m = re.exec(text));) {
    let depth = 0, i = m.index + 1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ at: m.index, tag: text.slice(m.index, i + 1) });
  }
  return out;
}
const lineOf = (text, at) => text.slice(0, at).split("\n").length;
const insideLabel = (text, at) => { const before = text.slice(0, at); return (before.match(/<label\b/g) ?? []).length > (before.match(/<\/label>/g) ?? []).length; };

test("every page has a skip link target, and the layout has the skip link", () => {
  assert.match(readFileSync(path.join(root, "app/layout.tsx"), "utf8"), /className="skip-link" href="#main"/);
  for (const { file, text } of sources) for (const { at, tag } of openingTags(text, "main")) {
    assert.match(tag, /id="main"/, `${file}:${lineOf(text, at)} <main> needs id="main" for the skip link`);
  }
});

test("every form field has a name a screen reader can read", () => {
  const unnamed = [];
  for (const { file, text } of sources) for (const name of ["input", "select", "textarea"]) for (const { at, tag } of openingTags(text, name)) {
    if (/type="hidden"/.test(tag) || /aria-label(ledby)?=/.test(tag) || insideLabel(text, at)) continue;
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    if (id && text.includes(`htmlFor="${id}"`)) continue;
    const dynamicId = tag.match(/\bid=\{([^}]+)\}/)?.[1];
    if (dynamicId && text.includes(`htmlFor={${dynamicId}}`)) continue;
    unnamed.push(`${file}:${lineOf(text, at)} <${name}>`);
  }
  assert.deepEqual(unnamed, []);
});

test("every picture has alt text (empty for decoration)", () => {
  const missing = [];
  for (const { file, text } of sources) for (const { at, tag } of openingTags(text, "img")) if (!/\balt=/.test(tag)) missing.push(`${file}:${lineOf(text, at)}`);
  assert.deepEqual(missing, []);
});

test("icon-only buttons say what they do", () => {
  const missing = [];
  for (const { file, text } of sources) for (const { at, tag } of openingTags(text, "button")) {
    if (/aria-label=|title=/.test(tag)) continue;
    const end = text.indexOf("</button>", at);
    if (end < 0) continue;
    const body = text.slice(at + tag.length, end).replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    if (/\{/.test(body) || /[A-Za-z]{2,}/.test(body)) continue;
    missing.push(`${file}:${lineOf(text, at)}`);
  }
  assert.deepEqual(missing, []);
});
