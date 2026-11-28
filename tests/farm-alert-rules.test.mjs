import test from "node:test";
import assert from "node:assert/strict";
import { alertable, farmAlertEmail, planFarmAlerts, MIN_GAP_MS } from "../lib/farm-alert-rules.mjs";

const check = { id: "check-f1", tone: "attention", text: "Today's daily check for Pen 1 has not been recorded.", action: { label: "Record it", href: "/operations" } };
const feed = { id: "feed-store", tone: "urgent", text: "Feed in store lasts about 2 days.", action: { label: "Buy feed", href: "/finances#feed" } };
const cases = { id: "cases", tone: "attention", text: "1 health case is past the review date." };
const info = { id: "loss-f1", tone: "info", text: "2 birds lost in Pen 1 in the last 7 days." };
const vision = { id: "vision-findings", tone: "urgent", text: "Vision found something." };
const T = Date.parse("2026-11-28T16:00:00Z");
const local = (hour, date = "2026-11-28") => ({ date, hour });

test("only urgent and attention record items; Vision items have their own emails", () => {
  assert.equal(alertable(info, 12), false);
  assert.equal(alertable(vision, 12), false);
  assert.equal(alertable(cases, 12), true);
  assert.equal(alertable(feed, 3), true);
});

test("end-of-day tasks wait until 15:00 farm time", () => {
  assert.equal(alertable(check, 9), false);
  assert.equal(alertable(check, 15), true);
  assert.equal(planFarmAlerts([check], null, local(9), T).send, false);
  assert.equal(planFarmAlerts([check], null, local(16), T).send, true);
});

test("quiet hours hold back non-urgent items but not urgent ones", () => {
  assert.equal(planFarmAlerts([cases], null, local(22), T).send, false);
  assert.equal(planFarmAlerts([cases], null, local(5), T).send, false);
  const urgent = planFarmAlerts([cases, feed], null, local(22), T);
  assert.equal(urgent.send, true);
  assert.deepEqual(urgent.items.map((i) => i.id), ["feed-store", "cases"], "urgent first");
});

test("each item at most once a farm day, and at most one email every two hours unless new and urgent", () => {
  const first = planFarmAlerts([cases], null, local(10), T);
  assert.equal(first.send, true);
  assert.equal(planFarmAlerts([cases], first.state, local(11), T + 3_600_000).send, false, "same item, same day");
  const another = { id: "wd-f1x", tone: "attention", text: "Withdrawal runs until Monday." };
  assert.equal(planFarmAlerts([cases, another], first.state, local(11), T + 3_600_000).send, false, "new but not urgent, within two hours");
  const later = planFarmAlerts([cases, another], first.state, local(13), T + MIN_GAP_MS + 1);
  assert.equal(later.send, true);
  assert.deepEqual(later.items.map((i) => [i.id, i.fresh]), [["cases", false], ["wd-f1x", true]], "still-open items are listed but marked");
  assert.equal(planFarmAlerts([cases, feed], first.state, local(11), T + 600_000).send, true, "new urgent goes straight away");
});

test("a new farm day starts again", () => {
  const first = planFarmAlerts([cases], null, local(10), T);
  const next = planFarmAlerts([cases], first.state, local(10, "2026-11-29"), T + 86_400_000);
  assert.equal(next.send, true);
  assert.equal(next.state.date, "2026-11-29");
});

test("the email lists every item with its own link and how to stop them", () => {
  const plan = planFarmAlerts([feed, cases], null, local(10), T);
  const email = farmAlertEmail(plan.items, "Alchemy <Farms>", "https://flockence.com/", "https://flockence.com/");
  assert.equal(email.subject, "Alchemy <Farms>: 1 urgent item on the farm");
  assert.match(email.text, /URGENT: Feed in store lasts about 2 days\.\n  Buy feed: https:\/\/flockence\.com\/finances#feed/);
  assert.match(email.text, /Untick it there to stop them/);
  assert.ok(!email.html.includes("<Farms>"));
  assert.match(email.html, /<strong>Urgent:<\/strong> Feed in store/);
  assert.equal(farmAlertEmail([{ ...cases, fresh: true }], "F", "https://x.test/", "https://x.test/").subject, "F: 1 thing needs attention");
});
