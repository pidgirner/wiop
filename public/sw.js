const CACHE_VERSION = "lcs-v1.3.0";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "/",
  "/app",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/landing.css",
  "/landing.js",
  "/manifest.webmanifest",
  "/offline.html",
  "/icons/icon-wiop.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  event.respondWith(staleWhileRevalidateAsset(request));
});

async function networkFirstDocument(request) {
  try {
    const networkResponse = await fetch(request);
    const runtime = await caches.open(RUNTIME_CACHE);
    runtime.put(request, networkResponse.clone());
    return networkResponse;
  } catch (_error) {
    const runtime = await caches.open(RUNTIME_CACHE);
    const cached = await runtime.match(request);
    if (cached) {
      return cached;
    }

    const shell = await caches.open(STATIC_CACHE);
    return shell.match("/offline.html");
  }
}

async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch (_error) {
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}

async function staleWhileRevalidateAsset(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}
