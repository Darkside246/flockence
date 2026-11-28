import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyEmailTemplate, cleanTemplateField, emailCategories, emailCategoryIds, emailTemplateKey, EMAIL_TEMPLATE_LIMITS, sampleMessage,
} from "../lib/email-templates.mjs";

const reset = { subject: "Flockence password reset", html: '<p><a href="https://flockence.com/reset-password?token=abc">Reset your password</a></p>' };
const verify = { subject: "Verify your email for Flockence", text: "Confirm this email.\n\nhttps://flockence.com/signup/free?token=xyz" };

test("one template per kind of email the app already sends", () => {
  assert.deepEqual(emailCategoryIds, ["signup_verification", "welcome", "password_reset", "team_invitation", "vision_daily_report", "vision_alert"]);
  assert.deepEqual(emailCategories.filter((c) => c.group === "account").map((c) => c.id), ["signup_verification", "welcome", "password_reset"]);
  const mail = readFileSync(new URL("../lib/mail.ts", import.meta.url), "utf8");
  for (const id of emailCategoryIds) assert.match(mail, new RegExp(`templated\\("${id}"`), id + " is not applied in lib/mail.ts");
});

test("with nothing saved every email is unchanged", () => {
  for (const id of emailCategoryIds) {
    assert.deepEqual(applyEmailTemplate(id, verify, null), verify);
    assert.deepEqual(applyEmailTemplate(id, reset, {}), reset);
  }
});

test("a template adds an opening and closing but always keeps the working link", () => {
  const out = applyEmailTemplate("signup_verification", verify, { subject: "Welcome to {farm}", intro: "Hello from {farm}.", footer: "Questions? Reply." }, { farm: "Alchemy Farms" });
  assert.equal(out.subject, "Welcome to Alchemy Farms");
  assert.equal(out.text, "Hello from Alchemy Farms.\n\n" + verify.text + "\n\nQuestions? Reply.");
  const html = applyEmailTemplate("password_reset", reset, { intro: "Hi <b>there</b>\nsecond line", footer: "Bye & thanks" });
  assert.ok(html.html.includes(reset.html), "reset link kept");
  assert.ok(html.html.startsWith("<p>Hi &lt;b&gt;there&lt;/b&gt;<br>second line</p>"), html.html);
  assert.ok(html.html.endsWith("<p>Bye &amp; thanks</p>"));
});

test("report subjects can wrap the report's own subject", () => {
  const report = { subject: "Farm Vision: 2 things to check", text: "body", html: "<p>body</p>" };
  assert.equal(applyEmailTemplate("vision_daily_report", report, { subject: "[{farm}] {subject}" }, { farm: "Pen Hill" }).subject, "[Pen Hill] Farm Vision: 2 things to check");
  assert.equal(applyEmailTemplate("vision_alert", report, { subject: "" }).subject, report.subject);
});

test("fields are cleaned and capped", () => {
  assert.equal(cleanTemplateField("subject", "Line one\nline two\u0007"), "Line one line two");
  assert.equal(cleanTemplateField("intro", " a\r\nb\u0000 "), "a\nb");
  assert.equal(cleanTemplateField("subject", "x".repeat(400)).length, EMAIL_TEMPLATE_LIMITS.subject);
  assert.equal(cleanTemplateField("footer", 42), "");
  assert.equal(emailTemplateKey("welcome", "intro"), "email_template.welcome.intro");
});

test("test samples exist for every category and point at the farm's own site", () => {
  for (const id of emailCategoryIds) {
    const sample = sampleMessage(id, "https://flockence.com");
    assert.ok(sample?.subject, id);
    assert.ok(!/localhost/.test(JSON.stringify(sample)), id);
  }
});

test("the email settings are owner-only and the sending key never reaches the browser", () => {
  const page = readFileSync(new URL("../app/settings/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\["email", "Email"\]/);
  assert.match(page, /editable \|\| \["account", "appearance", "team", "storage"\]\.includes\(key\)/);
  for (const path of ["../app/api/settings/email-templates/route.ts", "../app/api/settings/email-templates/test/route.ts"]) {
    const route = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(route, /currentUserOrRoleResponse\(request, SETTINGS_ROLES\)/, path);
    assert.ok(!/process\.env\.RESEND_API_KEY\s*[,}]/.test(route.replace(/Boolean\(process\.env\.RESEND_API_KEY && process\.env\.RESEND_FROM\)|!process\.env\.RESEND_API_KEY \|\| !process\.env\.RESEND_FROM/g, "")), path + " exposes the key");
  }
});
