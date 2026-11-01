import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  allowedCameras, buildFlockCheck, deathCause, frameFromBytes, imageKind, oriyaLinkConfig, readFrameRequest, signOriyaBody, verifyOriyaSignature,
} from "../lib/oriya-link.mjs";

const SECRET = "s".repeat(43);
const KEY = "cop_" + "a".repeat(24);

test("signs exactly like Oriya: v1 HMAC-SHA256 over v1:<timestamp>:<raw body>", () => {
  const body = '{"camera":"Coop 1"}';
  const expected = "v1=" + createHmac("sha256", SECRET).update(`v1:1762000000:${body}`).digest("hex");
  assert.equal(signOriyaBody(SECRET, 1762000000, body), expected);
});

test("accepts only a fresh, correctly signed body", () => {
  const body = Buffer.from('{"requestId":"oriya-12345678","camera":"Coop 1"}');
  const now = 1762000000 * 1000;
  const sig = signOriyaBody(SECRET, 1762000000, body);
  assert.deepEqual(verifyOriyaSignature(SECRET, "1762000000", sig, body, now), { ok: true, timestamp: 1762000000 });
  assert.equal(verifyOriyaSignature(SECRET, "1762000000", sig, Buffer.from(body.toString() + " "), now).ok, false);
  assert.equal(verifyOriyaSignature("x".repeat(40), "1762000000", sig, body, now).reason, "BAD_SIGNATURE");
  assert.equal(verifyOriyaSignature(SECRET, "1762000000", sig, body, now + 301_000).reason, "TOO_OLD");
  assert.equal(verifyOriyaSignature(SECRET, "abc", sig, body, now).reason, "TOO_OLD");
});

test("link settings: HTTPS on oriya.si only, a real key id and a long secret", () => {
  const good = { ORIYA_URL: "https://app.oriya.si", ORIYA_LINK_KEY_ID: KEY, ORIYA_LINK_SECRET: SECRET };
  assert.deepEqual(oriyaLinkConfig(good), { baseUrl: "https://app.oriya.si", keyId: KEY, secret: SECRET });
  assert.equal(oriyaLinkConfig({ ...good, ORIYA_URL: "http://app.oriya.si" }), null);
  assert.equal(oriyaLinkConfig({ ...good, ORIYA_URL: "https://oriya.si.evil.example" }), null);
  assert.equal(oriyaLinkConfig({ ...good, ORIYA_URL: "https://user:pw@app.oriya.si" }), null);
  assert.equal(oriyaLinkConfig({ ...good, ORIYA_LINK_SECRET: "short" }), null);
  assert.equal(oriyaLinkConfig({ ...good, ORIYA_LINK_KEY_ID: "abc" }), null);
});

test("only listed cameras, by the code Oriya sees", () => {
  const map = allowedCameras({ ORIYA_CAMERAS: "Coop 1=Outdoor 4 Front, Coop 2 = Mini Back ,bad<code>=X,=Nameless" });
  assert.deepEqual([...map.entries()], [["Coop 1", "Outdoor 4 Front"], ["Coop 2", "Mini Back"]]);
});

test("reads Oriya's camera request strictly", () => {
  assert.deepEqual(readFrameRequest({ requestId: "oriya-12345678", camera: "Coop 1", frames: 3, secondsApart: 3 }), { requestId: "oriya-12345678", camera: "Coop 1", frames: 3, secondsApart: 3 });
  assert.equal(readFrameRequest({ requestId: "oriya-12345678", camera: "Coop 1", url: "rtsp://x" }), null);
  assert.equal(readFrameRequest({ requestId: "x", camera: "Coop 1" }), null);
  assert.equal(readFrameRequest({ requestId: "oriya-12345678", camera: "Coop 1", frames: 9 }), null);
});

test("frames are judged by their real bytes and size", () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  assert.equal(imageKind(jpeg), "image/jpeg");
  assert.equal(imageKind(Buffer.from("MZ program")), null);
  assert.deepEqual(frameFromBytes(jpeg, 3), { mimeType: "image/jpeg", imageBase64: jpeg.toString("base64"), secondsAfterFirst: 3 });
  assert.equal(frameFromBytes(Buffer.from("<html>"), 0), null);
  assert.equal(frameFromBytes(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_500_001)]), 0), null);
});

test("the flock check carries only Oriya's fields, with fixed death causes", () => {
  const check = buildFlockCheck({
    eventId: "chk-202611011200-HouseA", occurredAt: "2026-11-01T12:00:00Z", house: "House A", deathsSince: "2026-10-31T12:00:00Z",
    deaths: 5, causes: { HEAT: 4, UNKNOWN: 1, DISEASE: 0 }, feedStockKg: 120.04, feedUsedKg24h: 45, alive: 980, ageDays: 28, openHealthCases: 1,
  });
  assert.deepEqual(check, {
    eventId: "chk-202611011200-HouseA", type: "FLOCK_CHECK", occurredAt: "2026-11-01T12:00:00Z", house: "House A", source: "BLINK", cameras: [],
    mortality: { since: "2026-10-31T12:00:00Z", count: 5, causes: [{ cause: "HEAT", count: 4 }, { cause: "UNKNOWN", count: 1 }] },
    feed: { stockKg: 120, usedKgLast24h: 45 }, birds: { alive: 980, ageDays: 28 }, openHealthCases: 1,
  });
  assert.equal(deathCause("found panting, heat"), "HEAT");
  assert.equal(deathCause("mongoose got in"), "PREDATOR");
  assert.equal(deathCause(""), "UNKNOWN");
  assert.equal(deathCause("Mr Smith's dog"), "PREDATOR");
  assert.equal(deathCause("no idea"), "OTHER");
});
