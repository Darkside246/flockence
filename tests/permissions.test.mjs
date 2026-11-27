import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Who may change what (owner, 2026-11-27; lib/farm-roles.ts). These tests read the route handlers themselves, so a
// later change cannot quietly open a farm-wide setting to Supervisors or Farm Hands.

function handler(file, method) {
  const s = readFileSync(file, "utf8");
  const at = s.indexOf(`export async function ${method}(`);
  assert.ok(at >= 0, `${file} has ${method}`);
  const next = s.indexOf("export async function", at + 10);
  return s.slice(at, next < 0 ? s.length : next);
}

const OWNER_ONLY = {
  // Farm-wide settings, schedules and the daily email.
  "app/api/settings/route.ts": ["PUT"],
  "app/api/farm-setup/route.ts": ["PUT"],
  "app/api/vision/schedule/route.ts": ["PUT"],
  "app/api/vision/daily-report/route.ts": ["PUT"],
  "app/api/vision/eggs/route.ts": ["PUT"],
  // Catalogues and prices.
  "app/api/chick-prices/route.ts": ["PUT"],
  "app/api/feed-products/route.ts": ["POST", "PATCH"],
  "app/api/feed-measures/route.ts": ["POST", "PATCH"],
  "app/api/products/route.ts": ["POST"],
  "app/api/suppliers/route.ts": ["POST", "PATCH"],
  "app/api/storage-locations/route.ts": ["POST", "PUT"],
  "app/api/recurring-expenses/route.ts": ["POST"],
};

test("farm-wide settings, schedules, catalogues and prices can be changed by the owner only", () => {
  for (const [file, methods] of Object.entries(OWNER_ONLY)) for (const m of methods) {
    assert.match(handler(file, m), /currentUserOrRoleResponse\(request, SETTINGS_ROLES\)/, `${file} ${m} is owner-only`);
  }
  assert.match(readFileSync("lib/farm-roles.ts", "utf8"), /export const SETTINGS_ROLES = \["OWNER"\] as const/);
});

const OWNER_ROLE_LIST = /currentUserOrRoleResponse\(request, \["OWNER"\]\)/;
test("integrations, keys and camera sign-in stay owner-only", () => {
  for (const [file, methods] of Object.entries({
    "app/api/camera-gateway/route.ts": ["POST"], "app/api/camera-gateway/wyze/route.ts": ["POST", "DELETE"],
    "app/api/device-gateways/route.ts": ["POST"], "app/api/device-gateways/[id]/route.ts": ["DELETE"],
    "app/api/vision/people/route.ts": ["PUT"], "app/api/vision/detector/route.ts": ["PUT"],
  })) for (const m of methods) assert.match(handler(file, m), OWNER_ROLE_LIST, `${file} ${m}`);
  // Blink sign-in and sign-out, and other camera-service changes, go through the owner-only list in the proxy.
  assert.match(readFileSync("app/api/cameras/[...path]/route.ts", "utf8"), /currentUserOrRoleResponse\(request, \["OWNER"\]\)/);
});

test("pens are for owners and supervisors; Farm Hands cannot change them", () => {
  for (const [file, method] of [["app/api/pen-config/route.ts", "POST"], ["app/api/pens/route.ts", "POST"]]) {
    assert.match(handler(file, method), /currentUserOrRoleResponse\(request, \["OWNER", "MANAGER"\]\)/, `${file} ${method}`);
  }
});

test("no change anywhere is open to Read Only members", () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : f === "route.ts" && files.push(p); } };
  walk("app/api");
  for (const file of files) {
    const s = readFileSync(file, "utf8");
    for (const m of s.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g)) {
      const body = handler(file, m[1]);
      for (const call of body.matchAll(/currentUserOrRoleResponse\(request(?:,\s*\[([^\]]*)\])?/g)) {
        assert.ok(!/READ_ONLY/.test(call[1] ?? ""), `${file} ${m[1]} must not allow Read Only`);
      }
    }
  }
  // The default (no list given) is owners, supervisors and Farm Hands: never Read Only.
  assert.match(readFileSync("lib/current-user.ts", "utf8"), /allowedRoles: readonly FarmAccessRole\[\] = \["OWNER", "MANAGER", "WORKER"\]/);
});

test("supervisors may invite and change only Farm Hands and Read Only members", async () => {
  const { canInviteRole } = await import("../lib/farm-roles.ts").catch(() => import("../lib/farm-roles.mjs")).catch(() => ({}));
  if (!canInviteRole) {
    const s = readFileSync("lib/farm-roles.ts", "utf8");
    assert.match(s, /actor === "OWNER" && role === "MANAGER"/);
    assert.match(s, /\(actor === "OWNER" \|\| actor === "MANAGER"\) && \(role === "WORKER" \|\| role === "READ_ONLY"\)/);
    return;
  }
  assert.equal(canInviteRole("MANAGER", "MANAGER"), false);
  assert.equal(canInviteRole("MANAGER", "WORKER"), true);
  assert.equal(canInviteRole("WORKER", "WORKER"), false);
});
