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

// The shell essentials: everything the app needs to OPEN and run a full on-device
// verdict with zero network - route HTML, the JS/CSS chunks, the engine artifacts,
// the manifest and icons. The RSC `.txt` prefetch files are the only precache
// entries that are NOT essential: they only speed up client-side navigation, and
// the navigation fallback below covers offline routing without them. Splitting
// them out lets a flaky link drop a `.txt` without ever costing us "offline opens".
const CRITICAL = PRECACHE.filter((url) => !url.endsWith(".txt"));

// Fetch one entry into the cache, bypassing the HTTP cache so we never store a
// stale or half-written response. Returns true only on a genuine 200.
async function cacheOne(cache, url) {
  try {
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (response && response.ok) {
      await cache.put(url, response.clone());
      return true;
    }
  } catch {
    /* offline / flaky: reported to the caller as a miss */
  }
  return false;
}

// Resilient install. `cache.addAll` is ATOMIC - a single failed fetch aborts the
// whole thing and caches NOTHING, so on a rural 2G/3G link (exactly our users) the
// app silently fails to work offline. Instead we add every asset best-effort, then
// GUARANTEE the essentials: if any is still missing we retry it, and only fail the
// install if an essential truly cannot be fetched - so the browser retries the
// install later rather than leaving a half-populated, unusable cache.
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(PRECACHE.map((url) => cacheOne(cache, url)));

  let missing = [];
  for (const url of CRITICAL) if (!(await cache.match(url))) missing.push(url);
  if (missing.length) {
    await Promise.allSettled(missing.map((url) => cacheOne(cache, url)));
    missing = [];
    for (const url of CRITICAL) if (!(await cache.match(url))) missing.push(url);
  }
  if (missing.length) throw new Error(`precache incomplete: ${missing.length} essential asset(s)`);
}

self.addEventListener("install", (event) => {
  // Do NOT skipWaiting here: a new version waits until the user accepts the
  // "updated" toast, so an in-progress check is never yanked out from under them.
  // (First install has no controller, so activate still claims immediately below.)
  event.waitUntil(precache());
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

// Navigations are the whole ballgame for "does the site open offline".
//
// When you reopen the app (or the installed PWA) in airplane mode, the browser
// makes a NAVIGATION request for the URL. With no worker, that hits the network,
// fails, and the browser shows its offline error page - THIS is the exact reason a
// static site "doesn't open at all" offline. So here we go network-first (fresh
// HTML when online) and, when the fetch rejects, fall back to a cached document:
// the exact route if we precached it, otherwise the app shell at "/". App Router
// then does its own client-side routing from cache, so every screen still works.
// "/" is a guaranteed install essential, so this fallback can always answer.
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(request)) || (await cache.match("/"));
    if (cached) return cached;
    // Should be unreachable (install guarantees "/"), but never dead-end a nav.
    return new Response("<!doctype html><meta charset=utf-8><title>Offline</title>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
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
