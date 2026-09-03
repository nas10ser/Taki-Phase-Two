// TAKI service worker — v10.0 (network-first navigations to fix stale-page bug)
// Strategy:
//  • Navigations  → NETWORK-FIRST so a phone always sees the latest HTML
//                   (cache fallback only when the network is unreachable).
//                   The previous cache-first flow froze users on old builds
//                   because the bundled HTML referenced old JS hashes that
//                   the SW also kept serving.
//  • JS / CSS     → cache-first (Parcel content-hashes filenames already)
//  • API / data   → network-first with cache fallback (freshness wins)
//  • Other GETs   → stale-while-revalidate
//
// Bumping CACHE_NAME on every release triggers the activate handler which
// deletes every prior 'taki-cache-*' entry — guaranteeing a clean slate.
//
// CRITICAL: This MUST be bumped on every deploy. iOS Safari only checks for
// SW updates by diffing the sw.js bytes; if this constant doesn't change,
// the install/activate handlers never fire and users keep getting cached
// HTML / CSS from the previous release. (Bug observed v10.1–v10.14: 14
// deploys all kept serving v10.0 builds because nobody bumped this.)
const CACHE_NAME = 'taki-cache-v14.05';
// 🔴 v14.05 — كان فيها '/manifest.json' وهو **404** (الاسم الصحيح
// manifest.webmanifest). و`cache.addAll` **يرفض الدفعة كاملة** إن فشل عنصر
// واحد ⇒ فشل التثبيت في كل تحديث، ثم يمسح التفعيلُ المخزونَ القديم فلا يبقى
// ما يفتح الموقع بلا شبكة: «الموقع عندي لا يفتح» (بلاغ ناصر).
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.webmanifest'
];

const isAsset = url => /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|gif|ico)(?:\?.*)?$/i.test(url.pathname);
const isNavigation = req => req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
// v13.72 — 🔴 كان: `url.hostname.endsWith('supabase.co')` فقط.
//
// بعد نقل الخادم إلى جدة (v13.55) صار عنوان القاعدة `141-147-142-147.sslip.io`
// **ولا ينتهي بـsupabase.co** — فسقط كل نداء بيانات من هذا الشرط، ونزل إلى
// الفرع الأخير «stale-while-revalidate»: أي أن استعلامات GET (العروض،
// الحجوزات، الملفات) صارت تُقدَّم **من ذاكرة المتصفح أولاً** ثم تُحدَّث بعدها.
// وهذا يفسّر «التحديث لا يحدث في نفس اللحظة» في أكثر من شاشة.
//
// المعالجة الآن **بالمسار لا بالمضيف**: مسارات سوبابيس ثابتة مهما تغيّر
// الخادم أو النطاق (`/rest/v1`, `/auth/v1` …)، فلن يتكرّر هذا الفخ عند أي نقل
// قادم. ويُستثنى `/storage/v1/object/public` عمداً: الصور غير قابلة للتغيير
// (اسم فريد لكل ملف) وتخزينها هو المطلوب.
const API_PATHS = ['/rest/v1', '/auth/v1', '/realtime/v1', '/functions/v1', '/graphql/v1', '/api/'];
const isApi = url =>
  API_PATHS.some(p => url.pathname.startsWith(p)) ||
  (url.hostname.endsWith('supabase.co') && !url.pathname.startsWith('/storage/v1/object/public'));

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // كل عنصر على حدة: عنصرٌ يفشل (٤٠٤ أو انقطاع شبكة لحظي) لا يُسقط التثبيت
    // كلّه. الأهمّ أن يصل '/index.html' — وهو ما يُفحص عند التفعيل.
    await Promise.all(urlsToCache.map(u =>
      fetch(u, { cache: 'no-store' })
        .then(res => (res && res.ok) ? cache.put(u, res.clone()) : null)
        .catch(() => null)
    ));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 1) Take control of any open clients immediately so new fetches go through us.
    await self.clients.claim();

    // 2) Purge every cache that doesn't match the current name. This is what
    //    actually frees the user from the v9.x cache that was sticking the page
    //    on the old build.
    // 🔴 v14.05 — المسح **مشروط**: لا نهدم القديم قبل أن نتيقّن أن الجديد
    // يحمل صفحةً صالحة. كان المسح غير مشروط، فإن فشل التثبيت (شبكة ضعيفة
    // أو عنصر ٤٠٤) بقي المستخدم بلا أي نسخة ⇒ الموقع لا يفتح إطلاقاً.
    const names = await caches.keys();
    const cache = await caches.open(CACHE_NAME);
    let shell = await cache.match('/index.html');

    // الجديد فارغ؟ ننقذ الصفحة من أي مخزون قديم قبل حذفه.
    if (!shell) {
      for (const n of names) {
        if (n === CACHE_NAME) continue;
        const old = await caches.open(n);
        const hit = (await old.match('/index.html')) || (await old.match('/'));
        if (hit) { await cache.put('/index.html', hit.clone()); shell = hit; break; }
      }
    }
    // وإن تعذّر ذلك أيضاً، نجلبها من الشبكة قبل الحذف.
    if (!shell) {
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        if (res && res.ok) { await cache.put('/index.html', res.clone()); shell = res; }
      } catch (_) { /* بلا شبكة */ }
    }

    if (shell) {
      await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    }
    // لا صفحة أصلاً ⇒ نُبقي القديم: نسخة قديمة خير من شاشة «غير متصل».

    // 3) Tell every open tab to reload itself once. The first time a phone
    //    upgrades from v9.x → v10.x this is the kick that finally shows the
    //    new build without the user having to clear cache manually.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try { client.postMessage({ type: 'TAKI_SW_UPDATED', version: CACHE_NAME }); } catch (_) {}
    }
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never cache API / Supabase responses (auth, queries, RPCs, realtime)
  if (isApi(url)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // 1) Navigations: NETWORK-FIRST. Always try the network first so the
  //    phone sees the latest deploy as soon as it ships. Fall back to the
  //    cached HTML only when the device is genuinely offline.
  if (isNavigation(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.status === 200) {
          cache.put('/index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        let cached = (await cache.match('/index.html')) || (await cache.match(req));
        // v14.05 — البحث في **كل** المخزونات لا في الحالي وحده: بعد ترقية
        // فشل تثبيتها يكون الحالي فارغاً بينما القديم ما زال يحمل صفحة صالحة.
        if (!cached) {
          for (const n of await caches.keys()) {
            const c = await caches.open(n);
            cached = (await c.match('/index.html')) || (await c.match('/'));
            if (cached) break;
          }
        }
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // 2) Static assets: cache-first (Parcel bundles are content-hashed → immutable)
  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req).catch(() => null);
      if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res || new Response('', { status: 504 });
    })());
    return;
  }

  // 3) Default: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then(res => {
      if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => cached);
    return cached || (await networkPromise);
  })());
});

// ─── Cache versioning escape hatch ──────────────────────────────
// If a deploy ships with a hash mismatch, the page can post {type:'SKIP_WAITING'}
// or {type:'CLEAR_CACHE'} to recover without a hard reload loop.
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
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
