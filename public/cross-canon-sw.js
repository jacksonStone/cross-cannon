const SHELL_CACHE = "cross-canon-shell-v1";
const CONTENT_CACHE = "cross-canon-content-v1";
const OFFLINE_READER_URL = "/offline-reader.html";
const PRECACHED_SHELL_URLS = [
  OFFLINE_READER_URL,
  "/offline-reader.js",
  "/favicon-512.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHED_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.method !== "GET") {
    event.respondWith(networkOnly(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (PRECACHED_SHELL_URLS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isReaderContent(url)) {
    event.respondWith(staleWhileRevalidate(request, CONTENT_CACHE));
    return;
  }

  if (url.pathname.startsWith("/build/") || url.pathname.startsWith("/assets/")) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

async function networkOnly(request) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    notifyClients("online");
    return response;
  } catch {
    notifyClients("offline");
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());

    if (new URL(request.url).pathname === "/church-fathers") {
      await cache.put(new URL("/church-fathers", self.location.origin), response.clone());
    }

    notifyClients("online");
    return response;
  } catch {
    notifyClients("offline");
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }

    if (new URL(request.url).pathname === "/church-fathers") {
      const cachedFathersReader = await caches.match("/church-fathers");

      if (cachedFathersReader) {
        return cachedFathersReader;
      }
    }

    if (new URL(request.url).pathname.startsWith("/reader/")) {
      return caches.match(OFFLINE_READER_URL);
    }

    return (await caches.match("/")) ?? caches.match(OFFLINE_READER_URL);
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkRequest = new Request(request, { cache: "no-store" });
  const network = fetch(networkRequest)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      notifyClients("offline");
      return null;
    });

  if (cached) {
    void network;
    return cached;
  }

  const networkResponse = await network;

  if (networkResponse) {
    return networkResponse;
  }

  const priorVersion = await cache.match(request, { ignoreSearch: true });
  return priorVersion ?? new Response("Offline", { status: 503, statusText: "Offline" });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  return fetch(request);
}

function isReaderContent(url) {
  return url.pathname.startsWith("/scripture-cache/")
    || url.pathname.startsWith("/church-fathers-preview/");
}

async function notifyClients(state) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });

  for (const client of clients) {
    client.postMessage({ source: "cross-canon", type: state });
  }
}
