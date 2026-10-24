// Cache-first app shell so Shelf works offline. Bump VERSION whenever any shell file changes.
const VERSION = 'shelf-v4';
// No 'index.html': Cloudflare redirects it to './', and a cached redirect breaks navigations.
const SHELL = ['./', 'app.js', 'epub.js', 'worker.js', 'pkg/boko.js', 'pkg/boko_bg.wasm',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit ?? fetch(e.request)));
});
