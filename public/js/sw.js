// Service Worker der Handy-App. Er speichert keine Daten: Die Seiten kommen immer frisch vom Server.
// Ohne Netz zeigt er eine kurze Meldung statt einer leeren Browser-Fehlerseite.
'use strict';
const CACHE = 'kkb-offline-1';
const OFFLINE = '/static/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
