const CACHE = "chicken-op-v4";
const SHELL = ["/", "/batches", "/operations", "/layers", "/layers/performance", "/layers/packing", "/inventory", "/finances", "/planning", "/reports", "/settings", "/manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match("/"))));
});
