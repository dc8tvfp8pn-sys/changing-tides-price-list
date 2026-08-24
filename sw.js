/* Tides of Change — service worker.
   Static assets: cache-first (logo, icons, fonts, css).
   Pages + price data: network-first so prices are always fresh,
   with a cached copy as the offline fallback. */
var CACHE = 'toc-prices-v1';
var ASSETS = [
  './', './index.html', './styles.css', './script.v2.js', './prices-live.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './assets/icon-512-v9.png', './assets/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Price data from Supabase: always network, never serve from cache.
  if (url.hostname.indexOf('supabase.co') !== -1) {
    e.respondWith(fetch(e.request));
    return;
  }

  // HTML navigation: network-first, fall back to cache when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        if (res.ok && (url.origin === location.origin || url.hostname.indexOf('gstatic') !== -1 || url.hostname.indexOf('googleapis') !== -1)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
