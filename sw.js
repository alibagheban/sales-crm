/* Keeps the phone app's start-up files available offline. Customer data is never cached here (it comes from Dropbox). */
const C = 'salescrm-shell-v1';
const SHELL = ['./', 'index.html', 'config.js', 'dropbox-fs.js', 'boot.js', 'manifest.webmanifest', 'icons/icon-192.png', '_app/assets/logo-full.png', '_app/assets/logo-mark.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Dropbox, maps, fonts: straight to the network
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
