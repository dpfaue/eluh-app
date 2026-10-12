/* ELUH App – Service Worker: hält die App offline verfügbar und zeigt Push-Mitteilungen */
var VERSION = 'eluh-v2.2.2';
var FILES = [
  './', 'index.html', 'app.css', 'app.js', 'store.js', 'pdfgen.js', 'offline.js', 'termine.js', 'buero.js', 'config.js',
  'pdf-lib.min.js', 'pdf.min.js', 'pdf.worker.min.js', 'vorlage-arbeitsauftrag.pdf',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.png'
];
try { importScripts('config.js'); } catch (e) { /* offline beim Start – Push holt dann nur einen Standardtext */ }

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

// ---------------- Push-Mitteilungen ----------------
function idb() {
  return new Promise(function (resolve, reject) {
    var r = indexedDB.open('eluh-app');
    r.onsuccess = function () { resolve(r.result); };
    r.onerror = function () { reject(r.error); };
  });
}
function kv(mode, key, val) {
  return idb().then(function (d) {
    return new Promise(function (resolve, reject) {
      var st = d.transaction('kv', mode).objectStore('kv');
      var r = mode === 'readonly' ? st.get(key) : st.put(val, key);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  });
}

function fetchNotifications() {
  return Promise.all([kv('readonly', 'settings'), kv('readonly', 'notifSeq')]).then(function (v) {
    var s = v[0] || {}, since = v[1] || 0;
    if (!s.key || !self.ELUH_CONFIG) return [];
    return fetch(self.ELUH_CONFIG.BACKEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'notifications', key: s.key, deviceId: s.deviceId, since: since })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return [];
      return kv('readwrite', 'notifSeq', j.seq).then(function () { return j.items || []; });
    });
  }).catch(function () { return []; });
}

self.addEventListener('push', function (e) {
  e.waitUntil(fetchNotifications().then(function (items) {
    if (!items.length) return self.registration.showNotification('ELUH', { body: 'Neue Mitteilung – App öffnen', icon: 'icon-192.png', badge: 'icon-192.png' });
    return Promise.all(items.slice(-3).map(function (n) {
      return self.registration.showNotification(n.title, { body: n.body, tag: n.id, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: n.url } });
    }));
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = new URL(self.registration.scope).href + ((e.notification.data && e.notification.data.url) || '#/');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) { list[i].navigate ? list[i].navigate(target) : null; return list[i].focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
