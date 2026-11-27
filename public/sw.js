const CACHE = "flockence-offline-v5";
const SHELL = ["/offline.html", "/offline.css", "/offline.js", "/offline-store.js"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE && (name.startsWith("chicken-op-") || name.startsWith("flockence-offline-"))) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (SHELL.includes(url.pathname) && !url.search) {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match(url.pathname))
      .then((match) => match || Response.error())));
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match("/offline.html"))
      .then((match) => match || Response.error())));
  }
});
