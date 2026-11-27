import test from "node:test";
import assert from "node:assert/strict";
import { alertReason, planAlerts, alertEmail, MAX_PER_HOUR } from "../lib/vision-alert-rules.mjs";

const H = 3_600_000;
const f = (id, severity = "HIGH", state = "OBSERVED") => ({ id, severity, state, title: `Finding ${id}`, detail: "detail", penName: "Pen 1", cameraName: null });

test("only serious, open findings alert", () => {
  assert.equal(alertReason(f("a", "MEDIUM"), undefined, 0), null);
  assert.equal(alertReason(f("a", "INFO"), undefined, 0), null);
  assert.equal(alertReason(f("a", "HIGH", "DISMISSED"), undefined, 0), null);
  assert.equal(alertReason(f("a", "CRITICAL", "RESOLVED"), undefined, 0), null);
  assert.equal(alertReason(f("a", "HIGH"), undefined, 0), "NEW");
});

test("an incident seen again is quiet until it gets worse or its cooldown passes", () => {
  const last = { at: 0, severity: "HIGH", reminders: 0 };
  assert.equal(alertReason(f("a", "HIGH"), last, 2 * H), null);
  assert.equal(alertReason(f("a", "CRITICAL"), last, 2 * H), "WORSE");
  assert.equal(alertReason(f("a", "HIGH"), last, 12 * H), "STILL_THERE");
  assert.equal(alertReason(f("a", "CRITICAL"), { at: 0, severity: "CRITICAL", reminders: 0 }, 4 * H), "STILL_THERE", "urgent ones remind sooner");
  assert.equal(alertReason(f("a", "HIGH"), { ...last, reminders: 2 }, 48 * H), null, "at most two reminders");
});

test("one inspection's alerts go in one email; the hourly limit holds the rest for the daily report", () => {
  const first = planAlerts([f("a"), f("b", "CRITICAL"), f("c", "MEDIUM")], null, 0);
  assert.deepEqual(first.send.map((x) => [x.id, x.reason]), [["a", "NEW"], ["b", "NEW"]]);
  assert.equal(first.state.sentAt.length, 1);
  const again = planAlerts([f("a"), f("b", "CRITICAL")], first.state, H);
  assert.equal(again.send.length, 0, "the same incidents an hour later stay quiet");

  let state = { incidents: {}, sentAt: [] };
  for (let i = 0; i < MAX_PER_HOUR; i++) state = planAlerts([f(`x${i}`)], state, i * 1000).state;
  const over = planAlerts([f("y")], state, 10_000);
  assert.equal(over.held, true);
  assert.equal(over.send.length, 0);
  assert.equal(planAlerts([f("y")], state, H + 10_000).send.length, 1, "after the hour it goes out");
});

test("reminders are counted, and old incidents are forgotten after 14 days", () => {
  let s = planAlerts([f("a")], null, 0).state;
  s = planAlerts([f("a")], s, 12 * H).state;
  assert.equal(s.incidents.a.reminders, 1);
  s = planAlerts([f("a")], s, 24 * H).state;
  assert.equal(s.incidents.a.reminders, 2);
  assert.equal(planAlerts([f("a")], s, 36 * H).send.length, 0);
  assert.equal(planAlerts([], s, 40 * 24 * H).state.incidents.a, undefined);
});

test("the alert email says what and where, asks for an in-person check, and escapes model text", () => {
  const e = alertEmail([{ ...f("a", "CRITICAL"), title: "Possible dead bird", detail: "Lying <still>", reason: "NEW" }, { ...f("b"), title: "Wet litter", reason: "STILL_THERE" }], "Hasan's Farm", "Sat 14:05", "https://flockence.com/vision");
  assert.equal(e.subject, "Urgent: Possible dead bird and 1 more (Hasan's Farm)");
  assert.match(e.text, /- New: Possible dead bird, Pen 1\. Lying <still>/);
  assert.match(e.text, /- Still there: Wet litter, Pen 1/);
  assert.match(e.text, /check in person/);
  assert.ok(e.html.includes("Lying &lt;still&gt;"));
  assert.match(alertEmail([{ ...f("b"), reason: "NEW" }], "F", "t", "l").subject, /^Check soon: /);
});
