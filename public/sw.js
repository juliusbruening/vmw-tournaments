/* =========================================================
   Service Worker — VMW Live-App

   Strategie (bewusst minimal):
   - App-Shell (HTML/JS/CSS/Icons) wird beim Install vorgecached.
   - Navigationen & Shell-Assets: Network-first mit Cache-Fallback —
     die App lädt damit auch im Funkloch am Beckenrand.
   - /api/*: Network-first, bei Offline letzter gecachter Stand.
     Das Frontend zeigt das Datenalter eh über die "Stand HH:MM"-Pill,
     stale Daten sind also für den Nutzer erkennbar.
   - POST/PUT/DELETE laufen unangetastet durch (kein Offline-Queueing).

   CACHE_VERSION bei jedem Shell-relevanten Deploy hochzählen —
   activate räumt alte Caches weg.
   ========================================================= */
const CACHE_VERSION = 'vmw-shell-v1';
const API_CACHE     = 'vmw-api-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/phase3.js',
  '/style.css',
  '/phase3.css',
  '/manifest.webmanifest',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // externe Hosts (Logo etc.) nicht anfassen

  // API: Network-first, Offline-Fallback auf letzten gecachten Stand.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Navigationen: Network-first, Fallback auf gecachte Shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Statische Assets: Network-first mit Cache-Fallback. Frische Deploys
  // gewinnen, Offline funktioniert trotzdem.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
