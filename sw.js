/* ELUH App – Service Worker: hält die App komplett offline verfügbar */
var VERSION = 'eluh-v2.0.0';
var FILES = [
  './', 'index.html', 'app.css', 'app.js', 'store.js', 'pdfgen.js', 'config.js',
  'pdf-lib.min.js', 'pdf.min.js', 'pdf.worker.min.js', 'vorlage-arbeitsauftrag.pdf',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Backend-Aufrufe nie abfangen
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(function (r) { return r || fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (cached) {
    return cached || fetch(req);
  }));
});
