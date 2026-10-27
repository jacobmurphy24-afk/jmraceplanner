// Offline support. Online, every file is fetched fresh first, so an update shows the first time the
// app is opened; the copy is saved as it arrives. With no signal (or a connection so slow it doesn't
// answer within a few seconds), the saved copy is used instead, so the app still opens offline.
var CACHE = 'tp-v15';
var TIMEOUT_MS = 4000;
var FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'js/constants.js', 'js/store.js', 'js/ui.js',
             'js/charts.js', 'js/analysis.js', 'js/calendar.js', 'js/forms.js', 'js/reports.js', 'js/cloud.js', 'js/account.js', 'js/match.js', 'js/garmin.js',
             'js/pages.js', 'js/activity.js', 'js/coach.js', 'js/blocks.js', 'js/app.js',
             'js/firebase-config.js', 'vendor/firebase.js', 'vendor/fitsdk.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  // cache: 'reload' skips the browser's own HTTP cache, so the offline copy is the newest version.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (f) { return fetch(f, { cache: 'reload' }).then(function (r) { if (r.ok) return c.put(f, r); }); }));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    var saved = function () {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? c.match('./') : undefined) || Response.error();
      });
    };
    // 'no-cache' asks GitHub whether the file changed (a cheap 304 when it hasn't) instead of
    // trusting the browser's 10-minute copy.
    var net = fetch(req, { cache: 'no-cache' }).then(function (r) {
      if (r.ok) c.put(req, r.clone());
      return r;
    });
    // A slow connection switches to the saved copy only if there is one; otherwise it keeps waiting.
    var slow = new Promise(function (resolve) {
      setTimeout(function () { c.match(req, { ignoreSearch: true }).then(function (hit) { if (hit) resolve(hit); }); }, TIMEOUT_MS);
    });
    return Promise.race([net.catch(saved), slow]);
  }));
});
