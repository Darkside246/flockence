import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMERAS_PER_ROUND, camerasToRun, clockInZone, inQuietHours, inspectionsPerDay, isDue, normaliseSchedule,
  quietMinutes, readSchedule, readState, recordAttempt,
} from "../lib/vision-schedule-rules.mjs";

const base = { enabled: true, cameras: { "Coop 1": { everyHours: 2, mode: "video", category: "PEN" } }, dailyCap: 24, keepDays: 30, quietStart: "19:00", quietEnd: "05:30" };

test("a valid schedule is kept, with defaults filled in", () => {
  const r = normaliseSchedule({ enabled: true, cameras: { "Coop 1": { everyHours: "4" } } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.schedule.cameras["Coop 1"], { everyHours: 4, mode: "video", category: "PEN" });
  assert.equal(r.schedule.dailyCap, 24);
  assert.equal(r.schedule.keepDays, 30);
});

test("bad schedules are refused with a plain reason", () => {
  assert.equal(normaliseSchedule({ enabled: true, cameras: {} }).ok, false);
  assert.equal(normaliseSchedule({ enabled: true, cameras: { A: { everyHours: 5 } } }).ok, false);
  assert.equal(normaliseSchedule({ ...base, dailyCap: 0 }).ok, false);
  assert.equal(normaliseSchedule({ ...base, keepDays: 1000 }).ok, false);
  assert.equal(normaliseSchedule({ ...base, quietStart: "19:00", quietEnd: "" }).ok, false);
  assert.equal(normaliseSchedule({ ...base, cameras: { "../x": { everyHours: 2 } } }).ok, false);
  assert.equal(normaliseSchedule({ enabled: false, cameras: {} }).ok, true);
});

test("an unreadable stored schedule counts as off", () => {
  assert.equal(readSchedule("not json"), null);
  assert.equal(readSchedule(JSON.stringify({ enabled: true, cameras: { A: { everyHours: 7 } } })), null);
  assert.deepEqual(readState("{"), { day: "", runsToday: 0, leaseUntil: "", lastRoundAt: "", cameras: {} });
});

test("quiet hours, including a window across midnight", () => {
  assert.equal(inQuietHours("20:00", "19:00", "05:30"), true);
  assert.equal(inQuietHours("03:00", "19:00", "05:30"), true);
  assert.equal(inQuietHours("05:30", "19:00", "05:30"), false);
  assert.equal(inQuietHours("12:00", "19:00", "05:30"), false);
  assert.equal(inQuietHours("13:00", "12:00", "14:00"), true);
  assert.equal(inQuietHours("13:00", "", ""), false);
  assert.equal(quietMinutes("19:00", "05:30"), 630);
});

test("the farm clock is read in its own time zone", () => {
  // 16:00 UTC is 12:00 in Barbados (UTC-4, no daylight saving)
  assert.equal(clockInZone(new Date("2026-11-27T16:00:00Z"), "America/Barbados"), "12:00");
});

test("a camera is due after its interval, five minutes early at most", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  assert.equal(isDue(undefined, 2, now), true);
  assert.equal(isDue("2026-11-27T10:00:00Z", 2, now), true);
  assert.equal(isDue("2026-11-27T10:04:00Z", 2, now), true);
  assert.equal(isDue("2026-11-27T10:06:00Z", 2, now), false);
});

test("a round takes the most overdue cameras, within the daily and per-round limits", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  const cameras = Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((n) => [n, { everyHours: 1, mode: "video", category: "PEN" }]));
  const schedule = { ...base, cameras };
  const state = { day: "2026-11-27", runsToday: 0, leaseUntil: "", lastRoundAt: "", cameras: {
    A: { lastRunAt: "2026-11-27T10:30:00Z" }, B: { lastRunAt: "2026-11-27T09:00:00Z" }, C: { lastRunAt: "2026-11-27T11:30:00Z" } } };
  const run = camerasToRun(schedule, state, now, "2026-11-27").map((c) => c.name);
  assert.equal(run.length, CAMERAS_PER_ROUND);
  assert.equal(run.includes("C"), false, "C ran 30 minutes ago");
  // never-run cameras (D, E, F) first, then the oldest run (B); A and C wait for the next round
  assert.deepEqual(run, ["D", "E", "F", "B"]);
  assert.equal(camerasToRun({ ...schedule, dailyCap: 2 }, { ...state, runsToday: 1 }, now, "2026-11-27").length, 1);
  assert.equal(camerasToRun({ ...schedule, dailyCap: 2 }, { ...state, runsToday: 2 }, now, "2026-11-27").length, 0);
  // a new day resets the count
  assert.equal(camerasToRun({ ...schedule, dailyCap: 2 }, { ...state, day: "2026-11-26", runsToday: 2 }, now, "2026-11-27").length, 2);
  assert.equal(camerasToRun({ ...schedule, enabled: false }, state, now, "2026-11-27").length, 0);
});

test("failures count up and flag the camera; a success clears them", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  let s = recordAttempt(undefined, now, { ok: false, error: "offline" });
  s = recordAttempt(s, now, { ok: false, error: "offline" });
  assert.equal(s.needsAttention, false);
  s = recordAttempt(s, now, { ok: false, error: "offline" });
  assert.equal(s.failures, 3);
  assert.equal(s.needsAttention, true);
  s = recordAttempt(s, now, { ok: true, summary: "Birds spread evenly.", observationId: "obs1", severity: "LOW" });
  assert.equal(s.failures, 0);
  assert.equal(s.needsAttention, false);
  assert.equal(s.lastObservationId, "obs1");
});

test("the daily estimate respects quiet hours and the cap", () => {
  const schedule = { ...base, cameras: { A: { everyHours: 2, mode: "video", category: "PEN" }, B: { everyHours: 4, mode: "still", category: "PEN" } } };
  // 13.5 awake hours: A ceil(13.5/2)=7, B ceil(13.5/4)=4
  assert.equal(inspectionsPerDay(schedule, quietMinutes("19:00", "05:30")), 11);
  assert.equal(inspectionsPerDay({ ...schedule, dailyCap: 5 }, 0), 5);
});

import { fitScheduleToPlan, overBudget, planLimits, scheduleWithinPlan, visionPlan } from "../lib/vision-schedule-rules.mjs";

test("the plan follows the membership, and listed farms get Premium vision", () => {
  assert.equal(visionPlan("FREE", "f1"), "FREE");
  assert.equal(visionPlan("EXISTING", "f1"), "STANDARD");
  assert.equal(visionPlan("PREMIUM", "f1"), "PREMIUM");
  assert.equal(visionPlan("EXISTING", "default-farm", "x, default-farm"), "PREMIUM");
  assert.equal(visionPlan("UNAVAILABLE", "f1"), "FREE");
});

test("plan limits can be changed without code", () => {
  assert.equal(planLimits("STANDARD").dailyCap, 3);
  const custom = planLimits("STANDARD", JSON.stringify({ STANDARD: { dailyCap: 6, automatic: false, maxCameras: -1 } }));
  assert.equal(custom.dailyCap, 6);
  assert.equal(custom.automatic, false);
  assert.equal(custom.maxCameras, 1, "a negative number is ignored");
  assert.equal(planLimits("STANDARD", "not json").dailyCap, 3);
});

test("saving a schedule over the plan is refused in plain words; the daily cap is lowered to fit", () => {
  const standard = planLimits("STANDARD");
  const two = { ...base, cameras: { A: { everyHours: 6, mode: "video", category: "PEN" }, B: { everyHours: 6, mode: "video", category: "PEN" } } };
  const tooMany = fitScheduleToPlan(two, standard, "Standard");
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /The Standard plan includes automatic checks on 1 camera/);
  const tooOften = fitScheduleToPlan({ ...base, cameras: { A: { everyHours: 2, mode: "video", category: "PEN" } } }, standard, "Standard");
  assert.match(tooOften.error, /at most every 6 hours/);
  const fits = fitScheduleToPlan({ ...base, cameras: { A: { everyHours: 6, mode: "video", category: "PEN" } } }, standard, "Standard");
  assert.equal(fits.ok, true);
  assert.equal(fits.schedule.dailyCap, 3);
  assert.match(fitScheduleToPlan(base, planLimits("FREE"), "Free").error, /not included in the Free plan/);
  assert.equal(fitScheduleToPlan({ ...base, enabled: false }, planLimits("FREE"), "Free").ok, true, "switching off is always allowed");
});

test("a round never goes past the plan, even if the plan changed after saving", () => {
  const many = { ...base, dailyCap: 24, cameras: Object.fromEntries(["A", "B", "C"].map((n) => [n, { everyHours: 1, mode: "video", category: "PEN" }])) };
  const cut = scheduleWithinPlan(many, planLimits("STANDARD"));
  assert.deepEqual(Object.keys(cut.cameras), ["A"]);
  assert.equal(cut.cameras.A.everyHours, 6);
  assert.equal(cut.dailyCap, 3);
  assert.equal(scheduleWithinPlan(many, planLimits("FREE")), null);
  assert.equal(scheduleWithinPlan({ ...many, enabled: false }, planLimits("PREMIUM")), null);
});

test("the monthly budget stops automatic spending", () => {
  const standard = planLimits("STANDARD");
  assert.equal(overBudget(999_999, standard), false);
  assert.equal(overBudget(1_000_000, standard), true);
  assert.equal(overBudget(0, planLimits("FREE")), true);
});
