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

test("a refused email returns Resend's reason and logs it without the key or the full address", async (t) => {
  const { sendEmailWithResult } = await import("../lib/mail.ts");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: "API key is invalid", name: "validation_error", statusCode: 401 }), { status: 401 }));
  const warned = [];
  t.mock.method(console, "warn", (line) => warned.push(String(line)));
  process.env.RESEND_API_KEY = "ci-test-secret";
  process.env.RESEND_FROM = "Flockence <noreply@example.test>";
  const result = await sendEmailWithResult("owner@example.test", { subject: "x", text: "y" });
  assert.deepEqual(result, { ok: false, status: 401, reason: "API key is invalid" });
  assert.equal(warned.length, 1);
  assert.match(warned[0], /401 API key is invalid/);
  assert.ok(!warned[0].includes("ci-test-secret") && !warned[0].includes("owner@"), warned[0]);
});
