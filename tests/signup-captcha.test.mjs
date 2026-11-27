import assert from "node:assert/strict";
import test from "node:test";
import { verifySignupCaptcha } from "../lib/signup-captcha.ts";

test("signup requires a server-verified reCAPTCHA token from the signup domain", async (t) => {
  const previousSite = process.env.RECAPTCHA_SITE_KEY;
  const previousSecret = process.env.RECAPTCHA_SECRET_KEY;
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, hostname: "flockence.com",
  }));
  try {
    process.env.RECAPTCHA_SITE_KEY = "test-site";
    delete process.env.RECAPTCHA_SECRET_KEY;
    assert.equal(await verifySignupCaptcha("token", "flockence.com"), "unavailable");
    process.env.RECAPTCHA_SECRET_KEY = "test-secret";
    assert.equal(await verifySignupCaptcha("", "flockence.com"), "rejected");
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(await verifySignupCaptcha("token", "flockence.com"), "verified");
    const [url, request] = fetch.mock.calls[0].arguments;
    assert.equal(url, "https://www.google.com/recaptcha/api/siteverify");
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    assert.equal(request.body.get("secret"), "test-secret");
    assert.equal(request.body.get("response"), "token");
    assert.equal(await verifySignupCaptcha("token", "other.example"), "rejected");
    fetch.mock.mockImplementation(async () => Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    assert.equal(await verifySignupCaptcha("token", "flockence.com"), "rejected");
    fetch.mock.mockImplementation(async () => Response.json({ success: false, "error-codes": ["invalid-input-secret"] }));
    assert.equal(await verifySignupCaptcha("token", "flockence.com"), "unavailable");
    fetch.mock.mockImplementation(async () => { throw new Error("service unavailable"); });
    assert.equal(await verifySignupCaptcha("token", "flockence.com"), "unavailable");
  } finally {
    if (previousSite === undefined) delete process.env.RECAPTCHA_SITE_KEY;
    else process.env.RECAPTCHA_SITE_KEY = previousSite;
    if (previousSecret === undefined) delete process.env.RECAPTCHA_SECRET_KEY;
    else process.env.RECAPTCHA_SECRET_KEY = previousSecret;
  }
});

test("v3 requires a matching form action and risk score in addition to the hostname", async (t) => {
  for (const [key, value] of Object.entries({
    RECAPTCHA_MODE: "v3", RECAPTCHA_SITE_KEY: "test-site", RECAPTCHA_SECRET_KEY: "test-secret",
  })) {
    const prior = process.env[key];
    process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const result = { success: true, hostname: "flockence.com", action: "signup", score: 0.5 };
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json(result));
  assert.equal(await verifySignupCaptcha("test-token", "flockence.com", "signup"), "verified");
  assert.equal(await verifySignupCaptcha("test-token", "flockence.com", "login"), "rejected");
  assert.equal(await verifySignupCaptcha("test-token", "other.example", "signup"), "rejected");
  assert.equal(await verifySignupCaptcha("test-token", "flockence.com"), "rejected");
  for (const score of [undefined, "0.9", 0.49, 1.1]) {
    provider.mock.mockImplementation(async () => Response.json({ ...result, score }));
    assert.equal(await verifySignupCaptcha("test-token", "flockence.com", "signup"), "rejected");
  }
});
