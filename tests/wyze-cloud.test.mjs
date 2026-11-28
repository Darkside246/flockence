import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  freshEnough, hashPassword, loginHeaders, readCameraList, readLogin, readWyzeAnswer, safeThumbnailUrl, seal, uniqueNames, unseal, validCode, wyzeDeviceKey,
} from "../lib/wyze-cloud-rules.mjs";

const md5 = (s) => createHash("md5").update(s).digest("hex");

test("wyze: the password is sent the way Wyze expects (MD5 three times), never as typed", () => {
  assert.equal(hashPassword("  hunter2 "), md5(md5(md5("hunter2"))));
  assert.notEqual(hashPassword("hunter2"), "hunter2");
});

test("wyze: the login carries the API key headers", () => {
  const h = loginHeaders("key-id", "api-key");
  assert.equal(h.keyid, "key-id");
  assert.equal(h.apikey, "api-key");
});

test("wyze: the login answer becomes done, an app code, a text code or a plain refusal", () => {
  assert.deepEqual(readLogin({ access_token: "a", refresh_token: "r", user_id: "u" }), { step: "done", accessToken: "a", refreshToken: "r", userId: "u" });
  assert.deepEqual(readLogin({ access_token: "", mfa_options: ["TotpVerificationCode"], mfa_details: { totp_apps: [{ app_id: "app1" }] }, user_id: "u" }), { step: "totp", verificationId: "app1", userId: "u" });
  assert.deepEqual(readLogin({ mfa_options: ["PrimaryPhone"], sms_session_id: "s1", user_id: "u" }), { step: "sms", smsSessionId: "s1", userId: "u" });
  assert.equal(readLogin({ mfa_options: ["Email"] }).step, "refused");
  assert.equal(readLogin({}).step, "refused");
});

test("wyze: answer codes: fine, expired, or a plain message", () => {
  assert.deepEqual(readWyzeAnswer({ code: "1", data: { x: 1 } }), { ok: true, data: { x: 1 } });
  assert.equal(readWyzeAnswer({ code: "2001" }).expired, true);
  const bad = readWyzeAnswer({ errorCode: 1000, description: "UserNameOrPasswordError" });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /email and password/);
  assert.match(readWyzeAnswer({ code: 7, msg: "Invalid apikey" }).message, /API Key ID/);
});

test("wyze: only cameras are listed, with clean names and only Wyze picture addresses", () => {
  const cams = readCameraList({ device_list: [
    { product_type: "Camera", mac: "2CAA8E000001", nickname: "Barn / north", product_model: "HL_CAM4", device_params: { camera_thumbnails: { thumbnails_url: "https://wyze-device-alarm-file-face.s3.us-west-2.amazonaws.com/x.jpg?sig=1", thumbnails_ts: 1764331200000 } } },
    { product_type: "Camera", mac: "2CAA8E000002", nickname: "", product_model: "WYZE_CAKP2JFUS", device_params: { camera_thumbnails: { thumbnails_url: "http://169.254.169.254/latest", thumbnails_ts: 1764331200 } } },
    { product_type: "Plug", mac: "PLUG1", nickname: "Heater" },
    { product_type: "Camera", nickname: "no mac" },
  ] });
  assert.equal(cams.length, 2);
  assert.equal(cams[0].name, "Barn   north");
  assert.match(cams[0].thumbnail, /^https:\/\/wyze-device/);
  assert.equal(cams[0].thumbnailAt, new Date(1764331200000).toISOString());
  assert.equal(cams[1].name, "WYZE_CAKP2JFUS");
  assert.equal(cams[1].thumbnail, null, "a picture address outside Wyze's stores is never fetched");
  assert.equal(cams[1].thumbnailAt, new Date(1764331200000).toISOString(), "seconds are read as seconds");
});

test("wyze: picture addresses must be https on Wyze or its storage", () => {
  assert.ok(safeThumbnailUrl("https://wyze-thumb.s3.amazonaws.com/a.jpg"));
  assert.ok(safeThumbnailUrl("https://cdn.wyzecam.com/a.jpg"));
  for (const bad of ["http://cdn.wyzecam.com/a.jpg", "https://evil.example/a.jpg", "https://amazonaws.com.evil.example/a", "https://user:pw@cdn.wyzecam.com/a", "https://cdn.wyzecam.com:8443/a", "not a url", null]) {
    assert.equal(safeThumbnailUrl(bad), null, String(bad));
  }
});

test("wyze: tokens are sealed, and a changed or wrong-key value opens as nothing", () => {
  const secret = "s".repeat(40);
  const sealed = seal({ accessToken: "tok" }, secret);
  assert.ok(!sealed.includes("tok"));
  assert.deepEqual(unseal(sealed, secret), { accessToken: "tok" });
  assert.equal(unseal(sealed, "x".repeat(40)), null);
  assert.equal(unseal(sealed.slice(0, -2) + "AA", secret), null);
});

test("wyze: camera names never clash with the farm's other cameras", () => {
  const named = uniqueNames([{ name: "Barn" }, { name: "Barn" }, { name: "Yard" }], ["Barn"]);
  assert.deepEqual(named.map((c) => c.name), ["Barn (Wyze)", "Barn (Wyze 2)", "Yard"]);
  assert.match(wyzeDeviceKey("2CAA8E000001"), /^[a-f0-9]{64}$/);
  assert.equal(wyzeDeviceKey("2caa8e000001"), wyzeDeviceKey("2CAA8E000001"));
});

test("wyze: old or undated cloud pictures are skipped so a still picture never looks like still birds", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  assert.equal(freshEnough("2026-11-28T11:00:00Z", now, 180), true);
  assert.equal(freshEnough("2026-11-28T08:00:00Z", now, 180), false);
  assert.equal(freshEnough(null, now, 180), false);
  assert.equal(freshEnough("2026-11-28T13:00:00Z", now, 180), false);
  assert.ok(validCode("123456") && validCode(" 0123 ") && !validCode("12ab56") && !validCode("123"));
});
