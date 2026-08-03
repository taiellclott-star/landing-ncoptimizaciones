const CACHE_NAME = 'nc-optimizaciones-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/404.html',
  '/manifest.json',
  '/assets/logo.png',
  '/assets/favicon-192.png',
  '/assets/favicon-512.png',
  '/assets/favicon.svg'
];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(URLS_TO_CACHE);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) {
      return key !== CACHE_NAME;
    }).map(function(key) {
      return caches.delete(key);
    }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(function() {
    return caches.match(event.request).then(function(cached) {
      return cached || caches.match('/index.html');
    });
  }));
});
