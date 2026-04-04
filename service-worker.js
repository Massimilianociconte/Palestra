const CACHE_NAME = "gymbro-v6";
const DEFAULT_NOTIFICATION_URL = "./user.html";
const DEFAULT_NOTIFICATION_ICON = "assets/icon-512.png";
const DEFAULT_NOTIFICATION_BADGE = "assets/icon-192.png";
const ASSETS_TO_CACHE = [
    "./",
    "./index.html",
    "./user.html",
    "./analysis.html",
    "./diary.html",
    "./body.html",
    "./creator.html",
    "./records.html",
    "./friends.html",
    "./rooms.html",
    "./privacy.html",
    "./terms.html",
    "./manifest.json",
    "./favicon.svg",
    "./css/style.css",
    "./js/main.js",
    "./js/sanitize.js",
    "./js/auth-service.js",
    "./js/firestore-service.js",
    "./js/exercise-db.js",
    "./js/capacitor-bootstrap.js",
    "./js/notification-manager.js",
    "./js/media-session-manager.js",
    "./js/pr-tracker.js",
    "./assets/icon.svg",
    "./assets/icon-192.png",
    "./assets/icon-512.png",
    "./assets/apple-touch-icon.png"
];

function isCacheableResponse(response) {
    return Boolean(response && response.ok && response.type !== "opaque");
}

function buildNotificationOptions(rawOptions = {}) {
    const data = {
        url: rawOptions?.data?.url || DEFAULT_NOTIFICATION_URL,
        ...(rawOptions?.data || {})
    };

    return {
        icon: DEFAULT_NOTIFICATION_ICON,
        badge: DEFAULT_NOTIFICATION_BADGE,
        tag: "gymbro-notification",
        renotify: true,
        requireInteraction: false,
        ...rawOptions,
        data
    };
}

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => Promise.all(
            cacheNames.map((cacheName) => {
                if (cacheName !== CACHE_NAME) {
                    return caches.delete(cacheName);
                }

                return Promise.resolve();
            })
        ))
    );

    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== "GET") {
        return;
    }

    if (!url.protocol.startsWith("http")) {
        return;
    }

    const isDynamicDocument =
        request.mode === "navigate" ||
        url.pathname.endsWith(".html") ||
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".css") ||
        url.pathname === "/" ||
        url.pathname.endsWith("/");

    if (isDynamicDocument) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (isCacheableResponse(response)) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }

                    return response;
                })
                .catch(async () => {
                    const cachedResponse = await caches.match(request);
                    return cachedResponse || caches.match("./index.html");
                })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((response) => {
                if (isCacheableResponse(response)) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }

                return response;
            });
        })
    );
});

self.addEventListener("push", (event) => {
    const body = event.data ? event.data.text() : "Torna ad allenarti!";
    const options = buildNotificationOptions({
        body,
        tag: "timer-complete",
        requireInteraction: true,
        vibrate: [500, 200, 500],
        actions: [
            { action: "open", title: "Apri App" },
            { action: "dismiss", title: "Chiudi" }
        ],
        data: {
            url: DEFAULT_NOTIFICATION_URL,
            type: "timer_complete"
        }
    });

    event.waitUntil(
        self.registration.showNotification("⏱️ Recupero Terminato!", options)
    );
});

self.addEventListener("notificationclick", (event) => {
    const action = event.action;
    const notification = event.notification;
    const targetUrl = notification?.data?.url || DEFAULT_NOTIFICATION_URL;

    notification?.close();

    if (action === "dismiss") {
        return;
    }

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ("focus" in client) {
                    if ("navigate" in client && client.url !== targetUrl) {
                        client.navigate(targetUrl);
                    }

                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }

            return Promise.resolve();
        })
    );
});

self.addEventListener("message", (event) => {
    if (!event.data) {
        return;
    }

    if (event.data.type === "KEEP_ALIVE") {
        return;
    }

    if (event.data.type === "SHOW_NOTIFICATION") {
        const title = event.data.title || "GymBro";
        const options = buildNotificationOptions(event.data.options);
        event.waitUntil(self.registration.showNotification(title, options));
        return;
    }

    if (event.data.type === "CANCEL_ALL_NOTIFICATIONS") {
        event.waitUntil(
            self.registration.getNotifications().then((notifications) => {
                notifications.forEach((notification) => notification.close());
            })
        );
    }
});
