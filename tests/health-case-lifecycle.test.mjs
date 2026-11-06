import test from "node:test";
import assert from "node:assert/strict";
import { planAction, attention, OUTCOMES } from "../lib/health-case-lifecycle.ts";

const today = "2026-11-10";
const open = { status: "OPEN", severity: "MODERATE", affectedCount: 5, deathsCount: 2, movementRestricted: false, isolationRecommended: false, outcome: null, notifiable: false, reported: false, pendingTests: 0 };
const monitoring = { ...open, status: "MONITORING" };
const resolved = { ...open, status: "RESOLVED", outcome: "RECOVERED" };
const closed = { ...open, status: "CLOSED", outcome: "RECOVERED" };

test("a monitored case must carry a review date that is not in the past", () => {
  assert.equal(planAction(open, "monitor", {}, today).ok, false);
  assert.equal(planAction(open, "monitor", { nextReviewAt: "2026-11-09" }, today).ok, false);
  const ok = planAction(open, "monitor", { nextReviewAt: "2026-11-12", note: "Eating again" }, today);
  assert.equal(ok.ok, true);
  assert.equal(ok.status, "MONITORING");
  assert.equal(ok.event.fromStatus, "OPEN");
  assert.match(ok.event.note, /2026-11-12/);
});

test("only an open case can start monitoring; only a monitored case can be escalated", () => {
  assert.equal(planAction(monitoring, "monitor", { nextReviewAt: "2026-11-12" }, today).ok, false);
  assert.equal(planAction(open, "escalate", { note: "worse" }, today).ok, false);
  const worse = planAction(monitoring, "escalate", { note: "More birds coughing", severity: "HIGH" }, today);
  assert.equal(worse.ok, true);
  assert.equal(worse.status, "OPEN");
  assert.equal(worse.data.severity, "HIGH");
  assert.equal(worse.data.nextReviewAt, null);
});

test("resolving needs an outcome, and restrictions must be lifted on purpose", () => {
  assert.equal(planAction(open, "resolve", {}, today).ok, false);
  assert.equal(planAction(open, "resolve", { outcome: "MADE_UP" }, today).ok, false);
  const restricted = { ...open, movementRestricted: true };
  const blocked = planAction(restricted, "resolve", { outcome: "RECOVERED" }, today);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /restrictions/);
  const lifted = planAction(restricted, "resolve", { outcome: "RECOVERED", liftRestrictions: true, confirmedDiagnosis: "Coccidiosis" }, today);
  assert.equal(lifted.ok, true);
  assert.equal(lifted.status, "RESOLVED");
  assert.equal(lifted.data.movementRestricted, false);
  assert.equal(lifted.data.confirmedDiagnosis, "Coccidiosis");
  assert.ok(Object.keys(OUTCOMES).includes(lifted.data.outcome));
});

test("a case cannot be closed with a result pending, or before it is resolved", () => {
  assert.equal(planAction(open, "close", {}, today).ok, false);
  const pending = planAction({ ...resolved, pendingTests: 1 }, "close", {}, today);
  assert.equal(pending.ok, false);
  assert.match(pending.error, /pending/);
  const fine = planAction(resolved, "close", { note: "All records complete" }, today);
  assert.equal(fine.ok, true);
  assert.equal(fine.status, "CLOSED");
});

test("a suspected notifiable disease cannot be closed until it has been reported", () => {
  const blocked = planAction({ ...resolved, notifiable: true }, "close", {}, today);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Veterinary Services/);
  assert.equal(planAction({ ...resolved, notifiable: true, reported: true }, "close", {}, today).ok, true);
  const report = planAction({ ...open, notifiable: true }, "report", { reportedToAuthorityAt: "2026-11-09", authorityReference: "VS-123" }, today);
  assert.equal(report.ok, true);
  assert.equal(report.data.notifiable, true);
  assert.equal(planAction(open, "report", { reportedToAuthorityAt: "2026-12-01" }, today).ok, false);
});

test("reopening needs a reason, clears the ending, and counts how often a case came back", () => {
  assert.equal(planAction(closed, "reopen", {}, today).ok, false);
  const back = planAction(closed, "reopen", { note: "Coughing again in the same house" }, today);
  assert.equal(back.ok, true);
  assert.equal(back.status, "OPEN");
  assert.equal(back.data.closedAt, null);
  assert.equal(back.data.outcome, null);
  assert.deepEqual(back.data.reopenedCount, { increment: 1 });
  assert.equal(planAction(open, "reopen", { note: "x" }, today).ok, false);
});

test("a closed case is frozen: nothing can be added until it is reopened", () => {
  assert.equal(planAction(closed, "note", { note: "late thought" }, today).ok, false);
  assert.equal(planAction(closed, "report", { reportedToAuthorityAt: "2026-11-09" }, today).ok, false);
});

test("notes can correct counts, but deaths never go down", () => {
  const ok = planAction(open, "note", { note: "Two more birds lost", affectedCount: 9, deathsCount: 4 }, today);
  assert.equal(ok.ok, true);
  assert.equal(ok.data.deathsCount, 4);
  assert.equal(planAction(open, "note", { note: "typo", deathsCount: 1 }, today).ok, false);
  assert.equal(planAction(open, "note", { note: "" }, today).ok, false);
  const flagged = planAction(open, "note", { note: "Sudden deaths and twisted necks", notifiable: true }, today);
  assert.equal(flagged.data.notifiable, true);
  assert.equal(flagged.event.type, "FLAGGED");
});

test("attention flags: overdue reviews, silent open cases, unreported notifiable cases", () => {
  assert.deepEqual(attention({ status: "MONITORING", nextReviewAt: "2026-11-09" }, today), ["Review overdue"]);
  assert.deepEqual(attention({ status: "MONITORING", nextReviewAt: "2026-11-10" }, today), ["Review due today"]);
  assert.deepEqual(attention({ status: "MONITORING", nextReviewAt: "2026-11-15" }, today), []);
  assert.deepEqual(attention({ status: "OPEN", lastActivityAt: "2026-11-06T10:00:00Z" }, today), ["No update for 4 days"]);
  assert.deepEqual(attention({ status: "OPEN", lastActivityAt: "2026-11-09T10:00:00Z" }, today), []);
  assert.deepEqual(attention({ status: "OPEN", lastActivityAt: "2026-11-10T00:00:00Z", notifiable: true }, today), ["Suspected notifiable disease: not yet reported"]);
  assert.deepEqual(attention({ status: "CLOSED", nextReviewAt: "2020-01-01" }, today), []);
});
