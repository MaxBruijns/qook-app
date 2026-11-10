// Qook service worker: maakt de app installeerbaar op het beginscherm.
// Bewust zonder cache, zodat iedereen altijd de nieuwste versie krijgt.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
