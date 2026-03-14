/* ═══════════════════════════════════════════════════════════
   AveSampler — Service Worker
   Estrategia: Cache-First para assets estáticos
                Network-First para recursos externos
   ═══════════════════════════════════════════════════════════ */

'use strict';

const CACHE_NAME = 'avesampler-v1.0.0';
const CACHE_STATIC = 'avesampler-static-v1.0.0';
const CACHE_DYNAMIC = 'avesampler-dynamic-v1.0.0';

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/templates/aves_estandar.tex',
  '/templates/biodiversidad.tex',
  '/templates/registro_extendido.tex',
];

// External resources to cache when first loaded
const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing AveSampler Service Worker...');
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Cache install error:', err))
  );
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating AveSampler Service Worker...');
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== CACHE_STATIC && key !== CACHE_DYNAMIC)
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) return;

  // Static app assets: Cache-First
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // External CDN / Fonts: Cache-First with dynamic cache
  if (isExternalAsset(url)) {
    event.respondWith(cacheFirstDynamic(request));
    return;
  }

  // Everything else: Network-First
  event.respondWith(networkFirst(request));
});

// ── STRATEGIES ──────────────────────────────────────────────

/**
 * Cache-First: return from static cache, fallback to network
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Cache-First with dynamic caching: for CDN resources
 */
async function cacheFirstDynamic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline — recurso no disponible' });
  }
}

/**
 * Network-First: try network, fallback to cache
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

/**
 * Offline fallback: return main index.html for navigation requests
 */
async function offlineFallback(request) {
  if (request.headers.get('Accept')?.includes('text/html')) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
  }
  return new Response(
    JSON.stringify({ error: 'offline', message: 'Sin conexión a internet' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── HELPERS ─────────────────────────────────────────────────

function isStaticAsset(url) {
  const localPaths = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];
  return url.origin === self.location.origin && (
    localPaths.includes(url.pathname) ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/templates/')
  );
}

function isExternalAsset(url) {
  return (
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

// ── BACKGROUND SYNC ─────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reports') {
    console.log('[SW] Background sync: sync-reports');
    // Future: sync pending reports to server
  }
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'AveSampler', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: 'avesampler-notification',
  });
});

// ── MESSAGE HANDLING ────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data?.action === 'clearCache') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});

console.log('[SW] AveSampler Service Worker v1.0.0 loaded');
