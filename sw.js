// Service Worker: Seite offline nutzbar machen.
// - App-Gerüst (HTML/CSS/JS): zuerst Netz, offline der letzte Stand. So passen
//   nach einem Update alle Module zusammen (kein Mix aus alt und neu).
// - Daten (data/*.json, APIs): zuerst Netz, bei Offline der letzte Stand
// - Bilder: Cache, sobald einmal geladen

const VERSION = 'pitwall-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/css/style.css', 'assets/css/tipp.css',
  'assets/js/app.js', 'assets/js/config.js', 'assets/js/data.js', 'assets/js/ui.js', 'assets/js/stats.js',
  'assets/js/shared.js', 'assets/js/charts.js', 'assets/js/features.js', 'assets/js/news-feed.js',
  'assets/js/tipp/api.js', 'assets/js/tipp/common.js', 'assets/js/tipp/views.js', 'assets/js/tipp/form.js',
  'assets/js/tipp/rules.js', 'assets/js/tipp/sync.js', 'assets/js/tipp/ranking.js', 'assets/js/tipp/standings.js',
  'assets/icons/icon.svg', 'assets/icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Tippspiel-Server (Supabase) und CDN-Module laufen am Service Worker vorbei (nur Netz).
  if (/supabase\.co|jsdelivr\.net/.test(url.host)) return;
  const isData = url.pathname.includes('/data/') || url.pathname.includes('/supabase/') || /jolpi\.ca|openf1\.org|open-meteo\.com|wikipedia\.org/.test(url.host);
  const isImage = req.destination === 'image';

  if (isData) {
    // Live-Timing während Sessions nicht cachen (401 ohne CORS)
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION + '-data').then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  if (isImage) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION + '-img').then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin === location.origin) {
    // cache: 'no-cache' = beim Server kurz nachfragen (ETag, meist 304), damit
    // GitHub Pages' 10-Minuten-Browsercache keine alten Module liefert.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
  }
});
