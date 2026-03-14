'use strict';
const VER = 'v2.0.0';
const CS  = 'avesampler-static-'  + VER;
const CD  = 'avesampler-dynamic-' + VER;

const getStatic = base => [
  base, base+'index.html', base+'style.css', base+'app.js', base+'manifest.json',
  base+'templates/aves_estandar.tex', base+'templates/biodiversidad.tex', base+'templates/registro_extendido.tex',
  base+'data/aves.json', base+'icons/icon-192.png', base+'icons/icon-512.png',
];

self.addEventListener('install', e => {
  const base = self.registration.scope;
  e.waitUntil(
    caches.open(CS).then(cache =>
      Promise.allSettled(getStatic(base).map(u => cache.add(u).catch(()=>{})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CS&&k!==CD).map(k=>caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const {request:req} = e;
  if (req.method!=='GET' || !req.url.startsWith('http')) return;
  const url = new URL(req.url);
  const base = new URL(self.registration.scope);
  const isLocal = url.origin===base.origin && url.pathname.startsWith(base.pathname);
  const isCDN   = ['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);

  if (isLocal) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
      if(r.ok){ const cl=r.clone(); caches.open(CS).then(ca=>ca.put(req,cl)); } return r;
    }).catch(() => caches.match(base.href))));
  } else if (isCDN) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
      if(r.ok){ const cl=r.clone(); caches.open(CD).then(ca=>ca.put(req,cl)); } return r;
    }).catch(() => new Response('',{status:503}))));
  }
});

self.addEventListener('message', e => {
  if (e.data?.action==='skipWaiting') self.skipWaiting();
});
