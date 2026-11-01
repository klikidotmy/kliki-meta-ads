// Service worker: simpan app shell untuk buka laju. Data Meta (Apps Script) sentiasa dari network.
const CACHE = 'kliki-ads-shell-v1';
const SHELL = ['./', 'index.html', 'styles.css?v=1', 'js/config.js?v=1', 'js/app.js?v=1', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo-white.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kliki-ads-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Apps Script & font terus ke network
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
