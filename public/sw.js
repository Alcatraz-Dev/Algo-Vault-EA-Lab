// Service Worker for AlgoVault PWA
// Caches only static assets - NEVER caches sensitive trading/account data

const CACHE_NAME = "algovault-static-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// Assets that should never be cached
const NEVER_CACHE_PATTERNS = [
  "/api/",
  "/account/",
  "/admin/",
  "/dashboard",
  "/signals",
  "/bots",
  "/trading",
  "/portfolio",
  "/trade-journal",
  "/risk",
  "/ai-copilot",
  "/workflows",
  "/marketplace",
  "/settings",
  "/licenses",
  "/trade-management",
  "/copy-trading",
  "/strategy-lab",
  "/backtests",
  "/live",
  "/notifications",
  "/alerts",
  "/statement",
  "/equity-curve",
  "/execution-analytics",
];

function shouldNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((pattern) => url.includes(pattern));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls, authenticated pages, or sensitive routes
  if (
    shouldNeverCache(url.pathname) ||
    event.request.method !== "GET" ||
    event.request.headers.get("Authorization")
  ) {
    // Network only for sensitive requests
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return a custom offline response for navigation requests
        if (event.request.mode === "navigate") {
          return caches.match("/offline.html");
        }
        return new Response("Offline", { status: 503 });
      })
    );
    return;
  }

  // Static assets: cache first, then network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache, update in background
        event.waitUntil(
          fetch(event.request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
              }
            })
            .catch(() => {})
        );
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(event.request).then((response) => {
        // Only cache successful GET responses for static assets
        if (response.ok && event.request.method === "GET") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});

// Handle push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.message,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    vibrate: [200, 100, 200],
    tag: data.tag || "algovault-notification",
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.level === "critical",
    timestamp: data.timestamp || Date.now(),
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action) {
    // Handle action buttons
    const url = event.notification.data?.actionUrl;
    if (url) {
      event.waitUntil(clients.openWindow(url));
    }
    return;
  }

  // Default click - open the app
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Background sync for offline actions
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-notifications") {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  // Sync any pending notification reads when back online
  try {
    const response = await fetch("/api/notifications/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error("Sync failed");
  } catch {
    // Retry on next sync
  }
}

// Periodic background sync (if supported)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "refresh-market-data") {
    event.waitUntil(refreshMarketData());
  }
});

async function refreshMarketData() {
  // Only refresh non-sensitive public market data
  try {
    await fetch("/api/market/public-snapshot", { cache: "no-store" });
  } catch {
    // Ignore failures
  }
}