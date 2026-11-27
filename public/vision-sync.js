// Sends Farm Vision photos that were taken with no signal (kept in IndexedDB by lib/vision-send.ts), from the service
// worker, so they go even when Flockence is closed (Background Sync: Android and Chrome; iPhones send when the app
// opens instead). Each photo keeps its upload id, so the server analyses and charges it once however often it is sent.
// Plain script: loaded by sw.js with importScripts, and by the tests with require.
(function (root) {
  "use strict";
  var DB = "flockence-vision-queue";
  var STORE = "checks";
  var KEEP_MS = 7 * 86400000;

  /** What to do with a queued photo after the server answered with this status. */
  function verdict(status) {
    if (status >= 200 && status < 300) return "DONE";          // checked, or accepted and being checked (202)
    if (status === 401 || status === 429 || status >= 500) return "RETRY"; // signed out, rate-limited, server trouble
    return "DROP";                                              // refused for good (for example the monthly limit)
  }

  /**
   * Send this person's queued photos, oldest first. deps: { list(), remove(id), fetch, now() }.
   * A photo belongs to the person who took it: if someone else is signed in now, it waits for them.
   * Returns { sent, dropped, retry }; retry means try again later (the browser repeats the sync).
   */
  async function sendQueued(deps) {
    var me;
    try { me = await deps.fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" }); } catch (e) { return { sent: 0, dropped: 0, retry: true }; }
    if (!me.ok) return { sent: 0, dropped: 0, retry: me.status !== 401 && me.status !== 403 };
    var user = ((await me.json()) || {}).user;
    if (!user || !user.id) return { sent: 0, dropped: 0, retry: false };
    var all = (await deps.list()).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    var sent = 0, dropped = 0;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (deps.now() - c.createdAt > KEEP_MS) { await deps.remove(c.id); dropped++; continue; }
      if (c.userId !== user.id || c.farmId !== user.farmId) continue;
      var form = new FormData();
      form.append("image", new File([c.image], c.imageName || "photo.jpg", { type: (c.image && c.image.type) || "image/jpeg" }));
      for (var k in c.fields) if (Object.prototype.hasOwnProperty.call(c.fields, k)) form.append(k, String(c.fields[k]));
      var response;
      try {
        response = await deps.fetch("/api/vision", { method: "POST", body: form, credentials: "same-origin", headers: { "Idempotency-Key": c.id, Prefer: "respond-async" } });
      } catch (e) {
        return { sent: sent, dropped: dropped, retry: true };
      }
      var v = verdict(response.status);
      if (v === "RETRY") return { sent: sent, dropped: dropped, retry: true };
      await deps.remove(c.id);
      if (v === "DONE") sent++; else dropped++;
    }
    return { sent: sent, dropped: dropped, retry: false };
  }

  function openQueue() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB, 1);
      request.onupgradeneeded = function () { request.result.createObjectStore(STORE, { keyPath: "id" }); };
      request.onerror = function () { reject(request.error); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }
  function op(mode, run) {
    return openQueue().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var request = run(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(request.result); };
        tx.onabort = tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }
  /** The real queue, in the service worker. */
  function browserDeps() {
    return {
      list: function () { return op("readonly", function (s) { return s.getAll(); }); },
      remove: function (id) { return op("readwrite", function (s) { return s.delete(id); }); },
      fetch: function (url, init) { return fetch(url, init); },
      now: function () { return Date.now(); },
    };
  }

  var api = { TAG: "vision-queue", verdict: verdict, sendQueued: sendQueued, browserDeps: browserDeps };
  root.FlockenceVisionSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
