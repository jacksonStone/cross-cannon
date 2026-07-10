const META_CACHE = "cross-canon-offline-meta-v1";
const GENERAL_CONTENT_CACHE = "cross-canon-content-v2";
const SHELL_CACHE_PREFIX = "cross-canon-shell-v2-";
const ACTIVE_SHELL_URL = "/__cross-canon/active-shell";
const PENDING_SHELL_URL = "/__cross-canon/pending-shell";
const SHELL_HISTORY_URL = "/__cross-canon/shell-history";
const WORK_REGISTRY_URL = "/__cross-canon/work-registry";
const OFFLINE_READER_URL = "/offline-reader.html";
const PRECACHED_SHELL_URLS = [
  OFFLINE_READER_URL,
  "/offline-reader.js",
  "/favicon-512.png",
  "/manifest.webmanifest",
];
const releaseId = sanitizeCachePart(
  new URL(self.location.href).searchParams.get("release") ?? "current"
);
const candidateShellCache = `${SHELL_CACHE_PREFIX}${releaseId}`;
const shouldFailShellStage =
  ["127.0.0.1", "localhost"].includes(self.location.hostname) &&
  new URL(self.location.href).searchParams.get("failStage") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    stageShellGeneration(candidateShellCache)
      .then(() => writeMetaText(PENDING_SHELL_URL, candidateShellCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateStagedShell());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.headers.get("X-Cross-Canon-Download") === "1") {
    event.respondWith(networkOnly(request));
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

  if (isScriptureContent(url)) {
    event.respondWith(shellCacheFirst(request));
    return;
  }

  if (isEarlyChristianContent(url)) {
    event.respondWith(networkFirstEarlyChristianContent(request));
    return;
  }

  if (
    PRECACHED_SHELL_URLS.includes(url.pathname) ||
    url.pathname.startsWith("/build/") ||
    url.pathname.startsWith("/assets/")
  ) {
    event.respondWith(shellCacheFirst(request));
  }
});

async function stageShellGeneration(cacheName) {
  await caches.delete(cacheName);
  const cache = await caches.open(cacheName);

  try {
    const documentUrls = ["/", "/church-fathers"];
    const documents = await Promise.all(
      documentUrls.map(async (pathname) => {
        const response = await fetch(
          new Request(pathname, { cache: "no-store" })
        );

        if (!response.ok) {
          throw new Error(`Failed to stage ${pathname}: ${response.status}`);
        }

        const html = await response.clone().text();
        await cache.put(pathname, response);
        return html;
      })
    );
    const resources = new Set(PRECACHED_SHELL_URLS);

    for (const html of documents) {
      for (const url of collectDocumentResources(html)) {
        resources.add(url);
      }
    }

    if (shouldFailShellStage) {
      throw new Error("Intentional local shell-staging failure.");
    }

    await Promise.all(
      [...resources].map(async (pathname) => {
        const response = await fetch(
          new Request(pathname, { cache: "no-store" })
        );

        if (!response.ok) {
          throw new Error(`Failed to stage ${pathname}: ${response.status}`);
        }

        if (
          pathname.startsWith("/scripture-cache/") &&
          !(await isValidScriptureResponse(response))
        ) {
          throw new Error("Failed to validate the staged Scripture Cache.");
        }

        await cache.put(pathname, response);
      })
    );
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

function collectDocumentResources(html) {
  const resources = [];
  const attributePattern = /(?:href|src)="([^"]+)"/g;
  let match = attributePattern.exec(html);

  while (match) {
    const url = new URL(
      match[1].replaceAll("&amp;", "&"),
      self.location.origin
    );

    if (url.origin === self.location.origin) {
      resources.push(`${url.pathname}${url.search}`);
    }

    match = attributePattern.exec(html);
  }

  const scriptureMatch = html.match(/"scriptureCacheUrl":"([^"]+)"/);

  if (scriptureMatch?.[1]) {
    resources.push(scriptureMatch[1]);
  }

  return resources;
}

async function isValidScriptureResponse(response) {
  try {
    const payload = await response.clone().json();
    return Array.isArray(payload?.passages) && payload.passages.length > 0;
  } catch {
    return false;
  }
}

async function activateStagedShell() {
  const pending = await readMetaText(PENDING_SHELL_URL);

  if (!pending || pending !== candidateShellCache) {
    return;
  }

  await writeMetaText(ACTIVE_SHELL_URL, pending);
  await deleteMeta(PENDING_SHELL_URL);
  const history = await readMetaJson(SHELL_HISTORY_URL, []);
  const nextHistory = [
    pending,
    ...history.filter((name) => name !== pending),
  ].slice(0, 2);
  await writeMetaJson(SHELL_HISTORY_URL, nextHistory);
  const cacheNames = await caches.keys();

  await Promise.all(
    cacheNames
      .filter(
        (name) =>
          name.startsWith(SHELL_CACHE_PREFIX) && !nextHistory.includes(name)
      )
      .map((name) => caches.delete(name))
  );
}

async function networkOnly(request) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    void notifyClients("online");
    return response;
  } catch {
    void notifyClients("offline");
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    void notifyClients("online");
    return response;
  } catch {
    void notifyClients("offline");
    const cache = await openActiveShellCache();
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/reader/")) {
      return (await cache.match(OFFLINE_READER_URL)) ?? offlineResponse();
    }

    if (pathname === "/church-fathers") {
      return (await cache.match("/church-fathers")) ?? offlineResponse();
    }

    return (
      (await cache.match("/")) ??
      (await cache.match(OFFLINE_READER_URL)) ??
      offlineResponse()
    );
  }
}

async function shellCacheFirst(request) {
  const cache = await openActiveShellCache();
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    return await fetch(request);
  } catch {
    void notifyClients("offline");
    return offlineResponse();
  }
}

async function networkFirstEarlyChristianContent(request) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));

    if (response.ok) {
      const cache = await caches.open(GENERAL_CONTENT_CACHE);
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    void notifyClients("offline");
    const activeWorkResponse = await matchActiveWorkContent(request);

    if (activeWorkResponse) {
      return activeWorkResponse;
    }

    const cache = await caches.open(GENERAL_CONTENT_CACHE);
    return (
      (await cache.match(request)) ??
      (await cache.match(request, { ignoreSearch: true })) ??
      offlineResponse()
    );
  }
}

async function matchActiveWorkContent(request) {
  const records = await readMetaJson(WORK_REGISTRY_URL, {});

  for (const record of Object.values(records)) {
    if (!record?.complete || typeof record.cacheName !== "string") {
      continue;
    }

    const cache = await caches.open(record.cacheName);
    const response = await cache.match(request, { ignoreSearch: true });

    if (response) {
      return response;
    }
  }

  return null;
}

async function openActiveShellCache() {
  const active = await readMetaText(ACTIVE_SHELL_URL);
  return caches.open(active || candidateShellCache);
}

async function readMetaText(pathname) {
  const cache = await caches.open(META_CACHE);
  const response = await cache.match(metaUrl(pathname));
  return response ? response.text() : "";
}

async function writeMetaText(pathname, value) {
  const cache = await caches.open(META_CACHE);
  await cache.put(metaUrl(pathname), new Response(value));
}

async function readMetaJson(pathname, fallback) {
  const text = await readMetaText(pathname);

  if (!text) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeMetaJson(pathname, value) {
  await writeMetaText(pathname, JSON.stringify(value));
}

async function deleteMeta(pathname) {
  const cache = await caches.open(META_CACHE);
  await cache.delete(metaUrl(pathname));
}

function metaUrl(pathname) {
  return new URL(pathname, self.location.origin).href;
}

function isScriptureContent(url) {
  return url.pathname.startsWith("/scripture-cache/");
}

function isEarlyChristianContent(url) {
  return url.pathname.startsWith("/church-fathers-preview/");
}

function offlineResponse() {
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

function sanitizeCachePart(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
}

async function notifyClients(state) {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });

  for (const client of clients) {
    client.postMessage({ source: "cross-canon", type: state });
  }
}
