/* ═══════════════════════════════════════════════════════════
   AveSampler — Service Worker
   Usa self.registration.scope para derivar el BASE_PATH
   automáticamente → funciona en cualquier subdirectorio
   ═══════════════════════════════════════════════════════════ */

'use strict';

const CACHE_VERSION  = 'v1.1.0';
const CACHE_STATIC   = `avesampler-static-${CACHE_VERSION}`;
const CACHE_DYNAMIC  = `avesampler-dynamic-${CACHE_VERSION}`;

// self.registration.scope resuelve a la URL completa del scope,
// p.ej. "https://santag207.github.io/Forms.github.io/"
// Todos los assets se construyen relativos a esa base.
const getStaticAssets = (base) => [
  base,
  base + 'index.html',
  base + 'style.css',
  base + 'app.js',
  base + 'manifest.json',
  base + 'templates/aves_estandar.tex',
  base + 'templates/biodiversidad.tex',
  base + 'templates/registro_extendido.tex',
  base + 'icons/icon-192.png',
  base + 'icons/icon-512.png',
];

const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  const base = self.registration.scope;
  console.log('[SW] Installing — scope:', base);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        const assets = getStaticAssets(base);
        console.log('[SW] Pre-caching:', assets);
        // addAll individually so one failure doesn't abort all
        return Promise.allSettled(
          assets.map(url =>
            cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e.message))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // App shell & templates → Cache-First
  if (isAppAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // CDN / Fonts → Cache-First with dynamic fallback
  if (isExternalCDN(url)) {
    event.respondWith(cacheFirstDynamic(request));
    return;
  }

  // Rest → Network-First
  event.respondWith(networkFirst(request));
});

// ── STRATEGIES ──────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return fallback(request);
  }
}

async function cacheFirstDynamic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || fallback(request);
  }
}

async function fallback(request) {
  const base = self.registration.scope;
  if (request.headers.get('Accept')?.includes('text/html')) {
    const cached = await caches.match(base + 'index.html')
                || await caches.match(base);
    if (cached) return cached;
  }
  return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

// ── HELPERS ─────────────────────────────────────────────────

function isAppAsset(url) {
  const base = new URL(self.registration.scope);
  if (url.origin !== base.origin) return false;
  const p = url.pathname;
  const b = base.pathname; // e.g. "/Forms.github.io/"
  return p === b ||
         p === b.replace(/\/$/, '') ||
         p.startsWith(b + 'index') ||
         p.startsWith(b + 'style') ||
         p.startsWith(b + 'app.') ||
         p.startsWith(b + 'manifest') ||
         p.startsWith(b + 'templates/') ||
         p.startsWith(b + 'icons/');
}

function isExternalCDN(url) {
  return url.hostname === 'cdnjs.cloudflare.com' ||
         url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com';
}

// ── MESSAGES ────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') self.skipWaiting();
  if (event.data?.action === 'clearCache') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});

console.log('[SW] AveSampler Service Worker', CACHE_VERSION, 'loaded');
