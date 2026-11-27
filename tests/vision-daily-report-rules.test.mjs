import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, parseSettings, isDue, recipientsToSend, worthSending, dailyEmail } from "../lib/vision-daily-report-rules.mjs";

test("settings default to on at 07:00 farm time, and bad values fall back", () => {
  assert.deepEqual(DEFAULT_SETTINGS, { enabled: true, hour: 7 });
  assert.deepEqual(parseSettings(null), { enabled: true, hour: 7 });
  assert.deepEqual(parseSettings('{"enabled":false,"hour":18}'), { enabled: false, hour: 18 });
  assert.deepEqual(parseSettings('{"enabled":"yes","hour":25}'), { enabled: true, hour: 7 });
  assert.deepEqual(parseSettings("not json"), { enabled: true, hour: 7 });
});

test("due from the chosen hour until sent, once a day, never when off", () => {
  const s = { enabled: true, hour: 7 };
  assert.equal(isDue(s, { date: "2026-11-28", hour: 6 }, null), false);
  assert.equal(isDue(s, { date: "2026-11-28", hour: 7 }, null), true);
  assert.equal(isDue(s, { date: "2026-11-28", hour: 15 }, { date: "2026-11-28", sentTo: ["a"], done: false }), true, "a failed send retries the same day");
  assert.equal(isDue(s, { date: "2026-11-28", hour: 15 }, { date: "2026-11-28", sentTo: ["a"], done: true }), false);
  assert.equal(isDue(s, { date: "2026-11-29", hour: 8 }, { date: "2026-11-28", sentTo: ["a"], done: true }), true, "a new day starts fresh");
  assert.equal(isDue({ enabled: false, hour: 7 }, { date: "2026-11-28", hour: 9 }, null), false);
});

test("recipients: owners and managers who chose report emails, each once a day", () => {
  const users = [
    { id: "o", role: "OWNER", email: "o@farm.test", wantsReports: true },
    { id: "m", role: "MANAGER", email: "m@farm.test", wantsReports: true },
    { id: "w", role: "WORKER", email: "w@farm.test", wantsReports: true },
    { id: "n", role: "OWNER", email: "n@farm.test", wantsReports: false },
    { id: "x", role: "MANAGER", email: "x@oriya.invalid", wantsReports: true },
  ];
  assert.deepEqual(recipientsToSend(users, null, "2026-11-28").map((u) => u.id), ["o", "m"]);
  assert.deepEqual(recipientsToSend(users, { date: "2026-11-28", sentTo: ["o"], done: false }, "2026-11-28").map((u) => u.id), ["m"]);
  assert.deepEqual(recipientsToSend(users, { date: "2026-11-27", sentTo: ["o"], done: true }, "2026-11-28").map((u) => u.id), ["o", "m"]);
});

const report = {
  overall: { status: "ATTENTION", label: "Attention required" },
  summary: "Whole farm, last 24 hours: Attention required. One thing needs checking: possible dead or down bird.",
  actions: [{ kind: "DEAD_OR_DOWN_BIRD", severity: "HIGH", finding: "Possible dead or down bird in Pen 1", action: "Walk the pen and check the bird(s) noted." }],
  areas: [
    { area: "BIRDS", label: "Bird condition and behaviour", status: "ATTENTION", statusLabel: "Attention required", reasons: ["Bird lying still <by the wall>"] },
    { area: "LITTER", label: "Litter", status: "GOOD", statusLabel: "Good apparent condition", reasons: [] },
    { area: "EQUIPMENT", label: "Equipment", status: "INSUFFICIENT_DATA", statusLabel: "Insufficient data", reasons: [] },
  ],
  flocks: [{ name: "Batch 7", ageDays: 12, liveRecorded: 116, deathsInPeriod: 1, feedKgInPeriod: 14 }],
  coverage: { inspections: 5, hoursCovered: 5, hoursInPeriod: 24, silentCameras: ["Pen 2 cam"] },
};

test("a day with no pictures and nothing open is not sent", () => {
  assert.equal(worthSending(report), true);
  assert.equal(worthSending({ coverage: { inspections: 0 }, actions: [] }), false);
  assert.equal(worthSending({ coverage: { inspections: 0 }, actions: [{}] }), true, "open findings still go out");
});

test("the email leads with the condition and actions, shows records and coverage, and escapes text from the model", () => {
  const e = dailyEmail(report, "Hasan's Farm", "Sat 28 Nov", "https://flockence.com/cameras?tab=vision");
  assert.equal(e.subject, "Hasan's Farm: Attention required (Farm Vision, Sat 28 Nov)");
  assert.match(e.text, /1\. Possible dead or down bird in Pen 1\. Walk the pen/);
  assert.match(e.text, /Batch 7: day 12, 116 live in your records, 1 death recorded, 14 kg feed/);
  assert.match(e.text, /Not seen in the last 24 hours: Equipment\./);
  assert.match(e.text, /No pictures from: Pen 2 cam/);
  assert.match(e.text, /untick "Farm reports"/);
  assert.ok(!e.text.includes("Litter"), "good areas are not listed as needing attention");
  assert.ok(e.html.includes("&lt;by the wall&gt;") && !e.html.includes("<by the wall>"), "model text is escaped in HTML");
  assert.ok(e.html.includes('href="https://flockence.com/cameras?tab=vision"'));
  assert.ok(e.html.includes("Hasan&#39;s Farm"));
});
