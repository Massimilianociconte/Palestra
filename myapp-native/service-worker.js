const CACHE_NAME = 'gymbro-v3';
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
  './js/notification-manager.js',
  './assets/icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Network-first per HTML/JS/CSS, cache-first per assets statici
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Solo richieste GET
  if (event.request.method !== 'GET') return;
  
  // Network-first per file dinamici (HTML, JS, CSS)
  if (url.pathname.endsWith('.html') || 
      url.pathname.endsWith('.js') || 
      url.pathname.endsWith('.css') ||
      url.pathname === '/' ||
      url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Aggiorna la cache con la nuova versione
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Offline: usa la cache
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Cache-first per assets statici (immagini, font, ecc.)
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      });
    })
  );
});

// Handle notification click - bring app to foreground
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification.tag);
  
  event.notification.close();
  
  // Focus on existing window or open new one
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // If no window found, open a new one
      if (clients.openWindow) {
        return clients.openWindow('./user.html');
      }
    })
  );
});

// Handle push notifications (for future server-side push)
self.addEventListener('push', (event) => {
  console.log('Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'Torna ad allenarti!',
    icon: 'assets/icon.svg',
    badge: 'assets/icon.svg',
    vibrate: [500, 200, 500],
    requireInteraction: true,
    tag: 'timer-complete',
    actions: [
      { action: 'open', title: 'Apri App' },
      { action: 'dismiss', title: 'Chiudi' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('⏱️ Recupero Terminato!', options)
  );
});

// Handle notification actions
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  
  if (action === 'dismiss') {
    event.notification.close();
    return;
  }
  
  // Default action or 'open' action
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./user.html');
      }
    })
  );
});

// Keep service worker alive for background tasks
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    console.log('Service Worker: Keep alive ping received');
  }
  
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, options);
  }
});
