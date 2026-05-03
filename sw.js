// TAKI service worker
// Bumping CACHE_NAME forces every active client to evict the previous
// bundle (which was holding stale strings like "تعذر الحصول على موقعك").
const CACHE_NAME = 'taki-cache-v8.13';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(cacheNames =>
        Promise.all(cacheNames.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
      )
    ])
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cachedResponse => {
        const fetchedResponse = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        // Always go to the network for navigations so a fresh deploy
        // is picked up on the next page load instead of being shadowed
        // by the cached HTML.
        if (event.request.mode === 'navigate') {
          return fetchedResponse.catch(() => cachedResponse);
        }
        return cachedResponse || fetchedResponse;
      })
    )
  );
});

// ─── Web Push ────────────────────────────────────────────────────
// Payload shape (matches the Edge Function the
// `tr_notification_push` Postgres trigger calls):
//   { titleAr, titleEn, bodyAr, bodyEn, type, data, notifId }
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const lang = (self.__TAKI_LANG__ === 'en') ? 'en' : 'ar';
  const title = payload[lang === 'ar' ? 'titleAr' : 'titleEn'] || payload.title || 'TAKI';
  const body  = payload[lang === 'ar' ? 'bodyAr'  : 'bodyEn']  || payload.body  || '';
  const data  = payload.data || {};
  const url   = data.dealId ? `/deal/${data.dealId}` : (data.url || '/profile');

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/logo192.png',
    badge: '/logo192.png',
    data: { url, ...data },
    tag: data.dealId || payload.notifId || 'taki-generic',
    renotify: false,
    requireInteraction: false
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          c.focus();
          if ('navigate' in c) { try { c.navigate(url); } catch (_) {} }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
