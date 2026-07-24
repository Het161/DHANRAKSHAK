/*
 * DhanRakshak offline shell.
 *
 * The whole app must open and fully render with zero network: app shell, CSS,
 * i18n (bundled in the JS), engine artifacts, icons. Analysis of a user's message
 * is NEVER cached or replayed - that request goes to a different origin (the API),
 * which this worker deliberately ignores, so a private message is never stored and
 * a stale verdict is never served.
 *
 * The precache list and the two version strings below are injected at build time
 * by scripts/gen-sw-precache.mjs, which scans the static export. BUILD_ID keys the
 * cache, so a new deploy gets a fresh cache and the old one is dropped on activate.
 */
const BUILD_ID = "__BUILD_ID__";
const ENGINE_VERSION = "__ENGINE_VERSION__";
const PRECACHE = __PRECACHE_MANIFEST__;

const CACHE = `dhanrakshak-${BUILD_ID}`;

self.addEventListener("install", (event) => {
  // Do NOT skipWaiting here: a new version waits until the user accepts the
  // "updated" toast, so an in-progress check is never yanked out from under them.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isEngineArtifact(url) {
  return url.pathname.startsWith("/engine/");
}

function isImmutableAsset(url) {
  // Next.js content-hashes everything under /_next/static, so it never changes.
  return url.pathname.startsWith("/_next/static/");
}

// Stale-while-revalidate: serve the cached copy instantly, refresh it in the
// background when online. Used for engine artifacts so a new model rolls in
// quietly without ever blocking a verdict.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

// Navigations: fresh HTML when online, the precached shell when not, so the app
// always opens - airplane mode included.
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(request)) || (await cache.match("/")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The API lives on another origin; leave it entirely to the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (isEngineArtifact(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

// Keep the version reachable from DevTools > Application even when unused in code.
void ENGINE_VERSION;
