import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { verdict, sendQueued, TAG } = require("../public/vision-sync.js");

const DAY = 86_400_000;
const check = (id, extra = {}) => ({ id, userId: "u1", farmId: "f1", createdAt: 1_000 + Number(id.replace(/\D/g, "") || 0), fields: { category: "PEN", notes: "n" }, image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), imageName: "p.jpg", ...extra });

function fakes({ queue, me = { status: 200, body: { user: { id: "u1", farmId: "f1" } } }, answers = [] }) {
  const store = new Map(queue.map((c) => [c.id, c]));
  const posts = [];
  return {
    store, posts,
    deps: {
      list: async () => [...store.values()],
      remove: async (id) => { store.delete(id); },
      now: () => 2_000,
      fetch: async (url, init) => {
        if (url === "/api/auth/me") { if (me.throws) throw new TypeError("offline"); return { ok: me.status === 200, status: me.status, json: async () => me.body }; }
        const form = init.body;
        posts.push({ id: init.headers["Idempotency-Key"], prefer: init.headers.Prefer, category: form.get("category"), image: form.get("image") });
        const a = answers.shift() ?? 202;
        if (a === "offline") throw new TypeError("offline");
        return { ok: a < 300, status: a };
      },
    },
  };
}

test("the sync tag and what each server answer means", () => {
  assert.equal(TAG, "vision-queue");
  assert.deepEqual([200, 201, 202, 401, 429, 500, 503, 400, 403].map(verdict), ["DONE", "DONE", "DONE", "RETRY", "RETRY", "RETRY", "RETRY", "DROP", "DROP"]);
});

test("sends this person's photos oldest first, with their upload id, and empties the queue", async () => {
  const f = fakes({ queue: [check("c2"), check("c1")] });
  const r = await sendQueued(f.deps);
  assert.deepEqual(r, { sent: 2, dropped: 0, retry: false });
  assert.deepEqual(f.posts.map((p) => p.id), ["c1", "c2"]);
  assert.equal(f.posts[0].prefer, "respond-async");
  assert.equal(f.posts[0].category, "PEN");
  assert.equal(f.posts[0].image.type, "image/jpeg");
  assert.equal(f.store.size, 0);
});

test("another person's photo waits for them; old ones are dropped after 7 days", async () => {
  const f = fakes({ queue: [check("c1", { userId: "u2" }), check("c2", { farmId: "f2" }), check("c3", { createdAt: 2_000 - 8 * DAY })] });
  const r = await sendQueued(f.deps);
  assert.equal(f.posts.length, 0);
  assert.deepEqual([...f.store.keys()].sort(), ["c1", "c2"]);
  assert.equal(r.dropped, 1);
});

test("signed out, rate-limited, offline or server trouble: keep the photos and try later", async () => {
  for (const [setup, kept] of [
    [{ me: { status: 401 } }, 1],
    [{ me: { throws: true } }, 1],
    [{ answers: [429] }, 1],
    [{ answers: [503] }, 1],
    [{ answers: ["offline"] }, 1],
  ]) {
    const f = fakes({ queue: [check("c1")], ...setup });
    const r = await sendQueued(f.deps);
    assert.equal(f.store.size, kept);
    if (!setup.me || setup.me.throws) assert.equal(r.retry, true);
  }
});

test("a photo refused for good (for example the monthly limit) leaves the queue, and the rest still go", async () => {
  const f = fakes({ queue: [check("c1"), check("c2")], answers: [403, 201] });
  const r = await sendQueued(f.deps);
  assert.deepEqual(r, { sent: 1, dropped: 1, retry: false });
  assert.equal(f.store.size, 0);
});
