/*
 * Shimti Multimedia - Service Worker
 *
 * Registered by assets/scripts/register-sw.js.
 *
 * Static assets are stale-while-revalidate, so a changed asset propagates on its own
 * within one page load. Bumping CACHE_VERSION still evicts everything at once and is
 * useful for a big deploy, but nothing depends on anyone remembering to do it.
 *
 * Three things here differ from the naive version and each fixes a real failure mode:
 *
 * 1. Relative paths. The old list used '/', '/index.html', etc. On a GitHub Pages
 *    PROJECT site the app lives at /shimtimultimedia.com/, so absolute paths pointed at
 *    the user-site root and every precache entry 404'd, failing the whole install.
 *    Resolving against `registration.scope` works on the subfolder and on a custom
 *    domain later, with no edit.
 *
 * 2. An `activate` handler that deletes superseded caches. Without it every past cache
 *    version is retained forever, growing unboundedly and letting stale responses win.
 *
 * 3. Network-first for navigations. A blanket cache-first strategy is why sites get
 *    "stuck" on an old build: the HTML is served from cache forever and the user can
 *    never receive a deploy. HTML now prefers the network and falls back to cache when
 *    offline; immutable assets stay cache-first for speed.
 */

'use strict';

// Bump this on every deploy that changes precached assets. The activate handler below
// then removes the previous cache automatically.
const CACHE_VERSION = 'v4';
const CACHE_NAME = `shimti-${CACHE_VERSION}`;

// Resolved against the worker's scope, so these work on any base path.
const PRECACHE_PATHS = [
  './',
  'index.html',
  '404.html',
  'manifest.json',
  'favicon.ico',
  'about.html',
  'ai.html',
  'contact.html',
  'media.html',
  'shop.html',
  'work.html',
  'assets/styles/styles.css',
  'assets/styles/section.css',
  'assets/styles/doors.css',
  'assets/styles/workbench.css',
  'assets/scripts/ui-elements.js',
  'assets/scripts/section-panels.js',
  'assets/scripts/node-panels.js',
  'assets/scripts/title-panel.js',
  'assets/scripts/background.js',
  'assets/scripts/register-sw.js',
  'assets/scripts/doors.js',
  'assets/scripts/workbench.js',
  'assets/scripts/background-render.js',
  'assets/scripts/background-worker.js',
  'assets/data/languages.json',
  'assets/fonts/Orbitron-Variable.woff2',
  'assets/images/logo.png',
  'assets/images/og-card.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = PRECACHE_PATHS.map((p) => new URL(p, self.registration.scope).href);
    // addAll() rejects the whole install if any single request fails. Precaching each
    // entry individually means one missing asset degrades the cache instead of leaving
    // the site with no service worker at all.
    await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch (err) {
        console.warn('[sw] precache skipped:', url, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('shimti-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only same-origin GETs are cacheable here.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: network first, so a new deploy reaches the user immediately.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(request);
        return cached || caches.match(new URL('index.html', self.registration.scope).href);
      }
    })());
    return;
  }

  /*
   * Static assets: stale while revalidate.
   *
   * The cached copy is served immediately, AND a fresh copy is fetched in the background
   * and written over it. The previous version only did the first half - it returned the
   * cached response and stopped - so once an asset was in the cache it was served from
   * there forever, and the only way to ever see a new one was for somebody to remember to
   * bump CACHE_VERSION on the deploy that changed it.
   *
   * That is not a caching policy, it is a trap. It served a stale background script to a
   * live browser and the background simply stopped appearing, with nothing to indicate
   * why, because everything was behaving exactly as written.
   *
   * Revalidating means a stale asset costs one page load and then corrects itself, with
   * nothing for anyone to remember. CACHE_VERSION still exists, and bumping it still
   * evicts everything at once, but correctness no longer depends on it.
   */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const fresh = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    // Offline with nothing cached is the only case with nothing to return.
    return cached || (await fresh) || Response.error();
  })());
});
