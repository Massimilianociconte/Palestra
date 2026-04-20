const CACHE_NAME = "gymbro-v7";
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
    "./assets/apple-touch-icon.png",
    // P3.35: pre-rendered notification beep, used by NotificationManager
    "./assets/audio/beep.wav",
    // P2.22: self-hosted Lucide icons (no more unpkg CDN dependency)
    "./js/lib/lucide.min.js"
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

// P1.18 — Improved fetch strategy.
// - For NAVIGATIONS (request.mode === "navigate") we fall back to cached HTML
//   or index.html, because serving nothing would show an error page.
// - For JS/CSS we serve the cached response ONLY IF the network fails AND we
//   have a cached copy of the same URL. We never synthesize an HTML fallback
//   for scripts (would cause "Unexpected token '<'" at parse time).
// - For same-origin API-ish paths (e.g. /api/...) we do not intercept at all.
// - For third-party URLs we bypass the cache entirely.
function isApiRequest(url) {
    return (
        url.pathname.startsWith("/api/") ||
        url.hostname.endsWith("cloudfunctions.net") ||
        url.hostname.endsWith("googleapis.com") ||
        url.hostname.endsWith("firebaseio.com") ||
        url.hostname.endsWith("firebaseapp.com") ||
        url.hostname.endsWith("tryterra.co") ||
        url.hostname === "api.imgbb.com"
    );
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== "GET") return;
    if (!url.protocol.startsWith("http")) return;

    const sameOrigin = url.origin === self.location.origin;
    if (!sameOrigin) {
        // Let third-party requests pass through; browser and CSP handle them.
        return;
    }

    // Never intercept API calls — they must always reach the network.
    if (isApiRequest(url)) return;

    const isNavigation = request.mode === "navigate";
    const isHtml = url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/");
    const isScript = url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs");
    const isStyle = url.pathname.endsWith(".css");

    if (isNavigation || isHtml) {
        // Network-first, fallback to same-URL cache, then to index.html.
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (isCacheableResponse(response)) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    return cached || (await caches.match("./index.html")) || Response.error();
                })
        );
        return;
    }

    if (isScript || isStyle) {
        // Network-first with EXACT URL fallback only — never fall back to HTML
        // for script/style requests (would break parsing).
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (isCacheableResponse(response)) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    return cached || Response.error();
                })
        );
        return;
    }

    // Default: cache-first for static assets (images, fonts, etc.).
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(request).then((response) => {
                if (isCacheableResponse(response)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            }).catch(() => Response.error());
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
