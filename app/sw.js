const CACHE_NAME = 'drawler-v1';
const ASSETS = [
  'index.html',
  'css/style.css',
  'js/canvas.js',
  'js/api.js',
  'js/ui.js',
  'assets/icon.svg',
  'https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.2/dist/perfect-freehand.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Delete caches from older versions whenever CACHE_NAME is bumped
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  // Don't cache API calls
  if (event.request.url.includes('/API/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});