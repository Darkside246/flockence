import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { farmIdForBusiness, newSignIn, openSignIn, oriyaUserEmail, readIdentity, readProvisionRequest, sameState, sealSignIn } from "../lib/oriya-account.mjs";

const BIZ = "11111111-2222-4333-8444-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AUTH = "a".repeat(40);

test("setup request from Oriya: strict, and the farm id follows the business", () => {
  const good = { type: "PROVISION_FARM", requestId: "prov-abcdefgh", businessId: BIZ, farmName: "Hill Farm", link: { keyId: "cop_" + "k".repeat(24), secret: "s".repeat(43) } };
  assert.deepEqual(readProvisionRequest(good), { requestId: "prov-abcdefgh", businessId: BIZ, farmId: `oriya-${BIZ}`, farmName: "Hill Farm", link: good.link });
  assert.equal(readProvisionRequest({ ...good, farmId: "default-farm" }), null);
  assert.equal(readProvisionRequest({ ...good, businessId: "../x" }), null);
  assert.equal(readProvisionRequest({ ...good, link: { ...good.link, extra: 1 } }), null);
  assert.equal(readProvisionRequest({ ...good, link: { ...good.link, secret: "short" } }), null);
  assert.equal(farmIdForBusiness(BIZ), `oriya-${BIZ}`);
});

test("sign-in attempt: S256 challenge, signed cookie that expires and cannot be forged", () => {
  const attempt = newSignIn();
  assert.equal(createHash("sha256").update(attempt.verifier).digest("base64url"), attempt.challenge);
  assert.match(attempt.challenge, /^[A-Za-z0-9_-]{43}$/);
  const now = 1_762_000_000_000;
  const cookie = sealSignIn(AUTH, attempt, now);
  assert.deepEqual(openSignIn(AUTH, cookie, now + 60_000), { state: attempt.state, verifier: attempt.verifier });
  assert.equal(openSignIn(AUTH, cookie, now + 11 * 60_000), null);
  assert.equal(openSignIn("b".repeat(40), cookie, now), null);
  const [payload, mac] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ s: "mine", v: "x", e: now + 600_000 })).toString("base64url");
  assert.equal(openSignIn(AUTH, `${forged}.${mac}`, now), null);
  assert.ok(payload);
  assert.equal(sameState(attempt.state, attempt.state), true);
  assert.equal(sameState(attempt.state, attempt.state + "x"), false);
  assert.equal(sameState("", ""), false);
});

test("who signed in: strict, farm must be the business's own, roles mapped, no real email kept", () => {
  const good = { oriyaUserId: USER, name: "Sam Farmer", role: "VIEWER", businessId: BIZ, businessName: "Hill Farm", farmId: `oriya-${BIZ}` };
  assert.deepEqual(readIdentity(good), { ...good, role: "READ_ONLY" });
  assert.equal(readIdentity({ ...good, role: "ADMIN" }), null);
  assert.equal(readIdentity({ ...good, farmId: "default-farm" }), null);
  assert.equal(readIdentity({ ...good, oriyaUserId: "x" }), null);
  assert.equal(oriyaUserEmail(USER, `oriya-${BIZ}`), `${USER}.oriya-${BIZ}@oriya.invalid`);
});
