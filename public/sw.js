const CACHE_NAME = 'pharmacy-stock-shell-v2';
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/pharmacy-stock-192.png',
  '/icons/pharmacy-stock-512.png',
  '/icons/pharmacy-stock-maskable-512.png',
  '/icons/pharmacy-stock-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html')),
    );
    return;
  }

  const responseAndCache = caches.match(request).then((cached) => {
    if (cached) return { response: cached };

    return fetch(request).then((response) => {
      if (!response.ok) return { response };

      const copy = response.clone();
      const cacheWrite = caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
      return { response, cacheWrite };
    });
  });

  event.waitUntil(responseAndCache.then(({ cacheWrite }) => cacheWrite).catch(() => undefined));
  event.respondWith(responseAndCache.then(({ response }) => response));
});
