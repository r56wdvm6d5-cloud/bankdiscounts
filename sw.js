// Minimal service worker: caches the app shell so it opens offline once
// visited, and satisfies Chrome/Android's "installable" requirement for
// the Add to Home Screen prompt. Bump CACHE_NAME whenever index.html
// changes so returning visitors pick up the new version.
const CACHE_NAME = 'card-comp-v14-6-0';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the HTML shell (so you get edits the moment you're online),
// falling back to cache when offline. Cache-first for everything else (icons,
// fonts) since those rarely change and it keeps things fast.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const isShellPage = e.request.mode === 'navigate' || e.request.url.endsWith('/index.html');

  if (isShellPage) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((res) => res || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        return res;
      }).catch(() => cached)
    )
  );
});
