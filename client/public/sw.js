/*
 * FileBridge service worker
 * ------------------------------------------------------------------
 * Goals:
 *   1. Make the app installable and launchable offline (PWA) once it has
 *      been opened over a secure context (https:// — e.g. Tailscale Serve).
 *   2. Never touch live data: /api/*, /files/* and the websocket are always
 *      straight from the network, never cached.
 *   3. Never serve a stale build: static files are network-first and only
 *      fall back to the cache when the network is unreachable.
 */

const CACHE = 'filebridge-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // live data: never cache, never serve from cache
  if (url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/files/')
    || url.pathname === '/ws'
    || url.pathname.startsWith('/ws/')) return;

  // navigation: always try the network first (fresh HTML), offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((hit) => hit || Response.error())),
    );
    return;
  }

  // static assets: network-first, cache as a fallback / offline copy
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error())),
  );
});
