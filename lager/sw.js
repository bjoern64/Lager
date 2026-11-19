// Service Worker: legt alle Programmdateien (inkl. Scanner-Bibliothek) im Cache ab → Offline-Betrieb.
const V = "lager-v7";
const CORE = ["./", "index.html", "style.css", "manifest.webmanifest", "js/app.js", "js/engine.js", "js/db.js", "js/products.js",
  "js/xlsx.js", "js/pdf.js", "js/code128.js", "js/scanner.js", "js/audio.js", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(CORE);
    try { await c.add("lib/zxing.min.js"); } catch {} // fehlt die Bibliothek, meldet die App das verständlich
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== V) await caches.delete(k); await self.clients.claim(); })());
});
// Cache zuerst (schnell, offline), im Hintergrund aktualisieren.
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(V), hit = await c.match(r, { ignoreSearch: true });
    const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response("Offline", { status: 503 });
  })());
});
