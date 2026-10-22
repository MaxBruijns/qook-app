// Qook service worker.
//  - Maakt de app installeerbaar op het beginscherm.
//  - Zorgt dat de app (en je boodschappenlijst) ook opent zonder internet, bv. in de supermarkt.
// Pagina's: eerst het netwerk (altijd de nieuwste versie), anders de bewaarde kopie.
// Vaste bestanden en foto's: uit de bewaarde kopie (ze veranderen niet).
// Gegevens (/api): altijd via het netwerk.
const CACHE = 'qook-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

const STATIC = /^\/(assets\/|icons\/|favicon\.png$|manifest\.webmanifest$|api\/images\/|api\/ext\/)/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req, { ignoreSearch: true })
          || await caches.match(url.pathname.startsWith('/app') ? '/app/' : '/');
        return cached || new Response('Geen internetverbinding.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (STATIC.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
