import assert from "node:assert/strict";
import test from "node:test";
import { sendWelcomeEmail } from "../lib/mail.ts";

test("welcome email uses the configured verified sender and never blocks on disabled mail", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(request.headers["Idempotency-Key"], "flockence-welcome-fixture");
    const body = JSON.parse(request.body);
    assert.equal(body.from, "Flockence <noreply@example.test>");
    assert.deepEqual(body.to, ["owner@example.test"]);
    assert.match(body.text, /https:\/\/flockence\.com\/login/);
    return new Response(null, { status: 200 });
  });
  process.env.RESEND_API_KEY = "ci-test-secret";
  process.env.RESEND_FROM = "Flockence <noreply@example.test>";
  process.env.APP_URL = "https://flockence.com";
  process.env.FLOCKENCE_WELCOME_EMAIL = "";
  assert.equal(await sendWelcomeEmail("owner@example.test", "fixture"), false);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  process.env.FLOCKENCE_WELCOME_EMAIL = "on";
  assert.equal(await sendWelcomeEmail("owner@example.test", "fixture"), true);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});
