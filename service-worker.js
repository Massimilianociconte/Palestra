const CACHE_NAME = 'ironflow-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './user.html',
  './analysis.html',
  './diary.html',
  './body.html',
  './creator.html',
  './css/style.css',
  './js/main.js',
  './js/auth-service.js',
  './js/firestore-service.js',
  './js/exercise-db.js',
  './assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

