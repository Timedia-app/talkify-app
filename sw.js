// Talkify service worker : cache hors-ligne + notifications push (FCM)
const CACHE = "talkify-v3";
const ASSETS = ["./", "index.html", "css/app.css", "js/app.js", "js/store.js", "js/logic.js", "js/config.js", "js/seed.js", "js/icons.js", "js/vendor/jspdf.umd.min.js", "js/vendor/jspdf.plugin.autotable.min.js", "icons/logo-color.png",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/logo-header.png", "icons/badge-96.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (pour recevoir les mises à jour), cache si hors-ligne
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

self.addEventListener("push", e => {
  let p = {};
  try { p = e.data.json(); } catch (_) { p = { notification: { title: "Talkify", body: e.data ? e.data.text() : "" } }; }
  const n = p.notification || p.data || {};
  e.waitUntil(self.registration.showNotification(n.title || "Talkify", {
    body: n.body || "", icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    data: { url: (p.data && p.data.url) || "./" }, tag: (p.data && p.data.tag) || "talkify"
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => "focus" in x); return c ? c.focus() : self.clients.openWindow(e.notification.data.url || "./");
  }));
});
