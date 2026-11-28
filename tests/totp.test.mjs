import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode, base32Encode, codeForStep, decryptSecret, encryptSecret, findRecoveryCode, hashRecoveryCode,
  newRecoveryCodes, newSecret, otpauthUrl, stepAt, verifyCode,
} from "../lib/totp.mjs";

// RFC 6238 appendix B: SHA-1 seed "12345678901234567890", 8-digit codes; our 6 digits are the last six.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];

test("codes match the RFC 6238 test values", () => {
  for (const [seconds, eight] of RFC) assert.equal(codeForStep(RFC_SECRET, stepAt(seconds * 1000)), eight.slice(-6), String(seconds));
});

test("base32 round-trips and new secrets are 160 bits", () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.equal(base32Decode(newSecret()).length, 20);
  assert.throws(() => base32Decode("not base32!"));
});

test("a code is accepted one step either side, never twice, and never malformed", () => {
  const now = 1_764_000_000_000;
  const step = stepAt(now);
  const current = codeForStep(RFC_SECRET, step);
  assert.equal(verifyCode(RFC_SECRET, current, now), step);
  assert.equal(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), now), step - 1);
  assert.equal(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step + 2), now), null, "outside the window");
  assert.equal(verifyCode(RFC_SECRET, current, now, step), null, "already used");
  assert.equal(verifyCode(RFC_SECRET, "12 34 5", now), null);
  assert.equal(verifyCode(RFC_SECRET, current.slice(0, 3) + " " + current.slice(3), now), step, "spaces are ignored");
});

test("recovery codes are single values matched by hash", () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  const hashes = codes.map(hashRecoveryCode);
  assert.equal(findRecoveryCode(hashes, codes[3].toUpperCase().replace("-", " ")), 3);
  assert.equal(findRecoveryCode(hashes, "aaaa-aaaa"), -1);
});

test("the stored secret is encrypted with AUTH_SECRET and cannot be read with another", () => {
  const key = "k".repeat(40);
  const sealed = encryptSecret(RFC_SECRET, key);
  assert.ok(!sealed.includes(RFC_SECRET));
  assert.equal(decryptSecret(sealed, key), RFC_SECRET);
  assert.throws(() => decryptSecret(sealed, "x".repeat(40)));
  assert.throws(() => encryptSecret(RFC_SECRET, "short"));
});

test("authenticator link", () => {
  assert.equal(otpauthUrl("ABC", "me@farm.test"), "otpauth://totp/Flockence%3Ame%40farm.test?secret=ABC&issuer=Flockence&algorithm=SHA1&digits=6&period=30");
});
