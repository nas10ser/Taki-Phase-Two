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
const CACHE_NAME = 'taki-cache-v16.32';
// 🔴 v14.05 — كان فيها '/manifest.json' وهو **404** (الاسم الصحيح
// manifest.webmanifest). و`cache.addAll` **يرفض الدفعة كاملة** إن فشل عنصر
// واحد ⇒ فشل التثبيت في كل تحديث، ثم يمسح التفعيلُ المخزونَ القديم فلا يبقى
// ما يفتح الموقع بلا شبكة: «الموقع عندي لا يفتح» (بلاغ ناصر).
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  // v14.28 — شاشة الانقطاع. كان آخر مخرجٍ عند فقد الشبكة `Response('Offline')`:
  // كلمةٌ إنجليزية واحدة على صفحة بيضاء، بلا عربية ولا سببٍ ولا زرّ.
  '/offline.html'
];

const isAsset = url => /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|gif|ico)(?:\?.*)?$/i.test(url.pathname);
const isNavigation = req => req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
// v13.72 — 🔴 كان: `url.hostname.endsWith('supabase.co')` فقط.
//
// (v15.32) أُسقط الاسمُ القديم `141-147-142-147.sslip.io`: قِيس أن صفر عرضٍ
// من ٢١ يستعمله، وعنوانُه يشير إلى خادمٍ لم يعد لنا.
// وبعد نقل الخادم إلى جدة (v13.55) كان عنوان القاعدة ذاك الاسم
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
/**
 * 🔴 v15.79 — حدُّ المقطع يُثبَّت بالنقطة، وقاعدةٌ واحدة لكلّ المقارنات.
 * كان `h.endsWith('supabase.co')` عارياً، فـ`evilsupabase.co` و`x-supabase.co`
 * «خادمُنا» — نفسُ طبقةِ الخطأ التي سجّلتها CLAUDE.md عن `evil-takisa.net`.
 * (لم يكن ينفذ منها شيءٌ اليوم: `connect-src` تُقيّد `fetch` العاملِ نفسَه
 * ونمطُها `*.supabase.co` يشترط النقطة — أي أن السياسة كانت الحارسَ الوحيد.)
 */
const hostIs = (h, d) => h === d || h.endsWith('.' + d);
/** خادمنا نحن (القاعدة والتخزين) — يبقى على معالجته القديمة. وما عداه من
 *  مضيفين (بلاطات الخرائط، الخطوط، تيليجرام) يذهب للمتصفّح مباشرةً. */
const isOwnBackend = h =>
  h === 'api.takisa.net' || hostIs(h, 'supabase.co');

/**
 * 🔴 v15.79 — تخزينٌ **مستحيلُ الصلاحية**: `/storage/v1` لم يكن في `API_PATHS`
 * وشرطُ المضيف لا يطابق `api.takisa.net`، فكلُّ رابطٍ **موقَّع** لمرفق محادثةٍ
 * أو دليلِ شكوى كان ينزل إلى فرع «الملفّات الساكنة» (الامتداد `.jpg`)،
 * فيُخزَّن **بمفتاحِ الرابطِ الموقَّع كاملاً** ثم يُقدَّم من `cache.match`
 * **بلا أي إعادة تحقّق** — أي أن رمزاً منتهيَ الصلاحية يظلّ يسلّم المحتوى من
 * الجهاز أبداً، على جهازٍ قد يشترك فيه أكثرُ من شخص.
 * (لم يصل شيءٌ إلى المخزون اليوم لأن الصور تُطلب `no-cors` فتعود مبهمةً
 * (`status === 0`) فيرفضها شرطُ `status === 200` — أي أن الحمايةَ كانت **صفةً
 * عارضةً في موضعَي تصيير** لا قاعدةً في المُوجِّه. سطرٌ واحد (`crossOrigin`)
 * كان يكفي لإسقاطها.)
 * و`/object/public` و`/render/image/public` يبقيان قابلَين للتخزين عمداً:
 * صورُ العروض لا تتغيّر (اسمٌ فريد لكلّ ملفّ) وتخزينُها هو المطلوب.
 */
const isPrivateStorage = url =>
  /^\/storage\/v1\/(?:object|render\/image)\/(?:sign|authenticated|upload)\//.test(url.pathname);

/** صورةُ مستودعٍ **عامّة** — تُترك للمتصفّح (انظر الشرح في معالج fetch). */
const isPublicStorageImage = url =>
  /^\/storage\/v1\/(?:object|render\/image)\/public\//.test(url.pathname);

const isApi = url =>
  isPrivateStorage(url) ||
  API_PATHS.some(p => url.pathname.startsWith(p)) ||
  (hostIs(url.hostname, 'supabase.co') && !url.pathname.startsWith('/storage/v1/object/public'));

/**
 * وجهةُ إشعارٍ داخليّة أو `null` — نفسُ حكم `src/utils/returnTo.ts`
 * (`safeInternalPath`)، ولا سبيلَ لاستيراده هنا: العاملُ ملفٌّ مستقلّ لا
 * تحزمه Parcel. فالقاعدةُ مكتوبةٌ مرّتين **بنصٍّ واحد** وكلتاهما مقيسة.
 * 🪤 `//host` و`/\host` كلاهما يبدأ بشرطةٍ مائلة وكلاهما يخرج من الأصل
 *    (المتصفّح يحوّل `\` إلى `/`)، فالحكمُ بحلّ المسار ومقارنةِ الأصل.
 */
const safePath = p => {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 512) return null;
  try { return new URL(p, self.location.origin).origin === self.location.origin ? p : null; }
  catch { return null; }
};

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

    // v14.28 — تخزينٌ أوّليّ كافٍ للعمل بلا إنترنت.
    // 🪤 لم يكن ممكناً سرد حِزَم البرنامج هنا: Parcel يبصم أسماءها في كل بناء
    // (`index.4f2a8c1b.js`)، فأي قائمة ثابتة تتقادم مع أول نشر. والنتيجة أن
    // أول زائر يفقد الشبكة **قبل** أن يُحمّل الحِزم لا يجد ما يفتح به شيئاً:
    // الصفحة مخزَّنة والبرنامج الذي يُشغّلها ليس كذلك.
    // الحلّ: نقرأ index.html المخزَّن للتوّ ونستخرج منه أسماء الحِزم الفعلية
    // لهذا البناء. فالقائمة تتجدّد وحدها مع كل إصدار بلا صيانة.
    try {
      const shell = await cache.match('/index.html');
      if (shell) {
        const html = await shell.clone().text();
        const refs = new Set();
        const add = (m) => { if (m) refs.add(m.startsWith('/') ? m : '/' + m.replace(/^\.\//, '')); };
        for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) add(m[1]);
        for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) add(m[1]);
        for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi)) add(m[1]);
        // روابط خارجية (خطوط، شبكات توصيل) تُترك للمتصفّح: تخزينها هنا يخاطر
        // باستجابات مبهمة (opaque) تملأ الحصّة بلا فائدة.
        const local = [...refs].filter(u => !/^https?:/i.test(u));
        await Promise.all(local.map(u =>
          fetch(u).then(res => (res && res.ok) ? cache.put(u, res.clone()) : null).catch(() => null)
        ));
      }
    } catch { /* التخزين الأوّلي تحسينٌ لا شرط: فشلُه لا يُسقط التثبيت */ }
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

  // 🔴 v14.64 — طلبات المضيفين الآخرين تمرّ إلى المتصفّح مباشرةً بلا وساطة.
  // السبب مقيس: `fetch()` **داخل** الخدمة العاملة يخضع لـ`connect-src` من
  // سياسة الأمان، لا لـ`img-src`. فلمّا تغيّر مزوّد بلاطات الخريطة صارت كل
  // بلاطة تُطلب عبر الخدمة العاملة فتُحجب — خريطةٌ رمادية كاملة على جوّال
  // ناصر بينما `curl` من الجهاز يُرجعها ٢٠٠. (وقياسٌ حاسم: نفس البلاطة تُحمَّل
  // في صفحةٍ بلا خدمة عاملة وتفشل في صفحتنا.) وفائدةٌ ثانية: لم تعد بلاطات
  // الخريطة تُكدَّس في مخزون التطبيق.
  if (url.origin !== self.location.origin && !isOwnBackend(url.hostname)) return;

  /**
   * 🔴 v16.14 — صورُ المستودع العامّ تمرّ إلى المتصفّح **بلا وساطة**.
   * ═══════════════════════════════════════════════════════════════════
   * كانت تنزل إلى فرع «الملفّات الساكنة» أدناه (الامتداد `.jpg`)، فكلُّ
   * صورةٍ تكلّف: `caches.open` ثمّ `cache.match` ثمّ `cache.put` بنسخةٍ
   * كاملةٍ في CacheStorage. والمقيس أن هذا **كلفةٌ بلا مقابل**:
   *   ① الخادمُ يُرسل `cache-control: max-age=31536000` لهذه الصور (قِيس
   *      على الإنتاج) — فمخزنُ المتصفّح HTTP يُصيب أصلاً، وبلا أيّ كود.
   *   ② و`CACHE_NAME` يُرفع **كلَّ نشرة** (قاعدةٌ ثابتة عندنا)، والتفعيلُ
   *      يمسح كلَّ مخزونٍ لا يطابق الاسم ⇒ مخزونُ الصور يُباد مع كلّ
   *      إصدار. أي أنه **لا يكاد يُصيب بعد نشرة**، ويبقى منه ثمنُه:
   *      قراءةٌ فاشلةٌ وكتابةٌ كاملةٌ لكلّ صورة.
   *   ③ وحصّةُ CacheStorage على آيفون صغيرة؛ وملؤها بصورٍ أصليّةٍ (قِيس
   *      أصلٌ واحدٌ **٢٫٨ م.ب**) يُعرّض **قشرةَ التطبيق نفسَها** للإخلاء،
   *      فيصير الإقلاعُ البارد أبطأ — عكسُ المقصود تماماً.
   * ⇒ المتصفّحُ أقدرُ على هذه الصور منّا: مخزنُه يَعبُر النشرات، ويُدير
   *   الحصّةَ بنفسه، ويقدّمها بلا جولةٍ في الخدمة العاملة.
   * 🪤 و`/public/` وحدها: الروابطُ الموقَّعة (`sign`/`authenticated`) تبقى
   *    على معالجتها في `isApi` — رمزٌ منتهٍ لا يجوز أن يُقدَّم من مخزون.
   * 🪤 ولا يُمسّ المضيفُ الخاصّ بنا (`self.location.origin`): شعارُنا
   *    وأيقوناتُنا جزءٌ من قشرة العمل بلا شبكة.
   */
  if (url.origin !== self.location.origin && isPublicStorageImage(url)) return;

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
        // لا نسخة من الصفحة في أي مخزون ⇒ شاشة الانقطاع العربية.
        if (cached) return cached;
        for (const n of await caches.keys()) {
          const c = await caches.open(n);
          const off = await c.match('/offline.html');
          if (off) return off;
        }
        return new Response(
          '<!doctype html><html lang=ar dir=rtl><meta charset=utf-8>' +
          '<body style="font-family:system-ui;text-align:center;padding:40px">' +
          '<h1>لا يوجد اتصال بالإنترنت</h1><p>تحقّق من اتصالك ثم أعد المحاولة.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
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

  // v14.13 — اللغة تُحسم على الخادم من `users.preferred_lang` ويصل العنوان
  // والنصّ جاهزين. 🪤 كان العامل يقرأ `self.__TAKI_LANG__` وهي غير معرَّفة
  // داخله أبداً — فكان كل مستخدم يصله العربي مهما كانت لغة حسابه.
  // النسختان ar/en تبقيان احتياطاً لأي رسالة من إصدار أقدم.
  const title = payload.title || payload.titleAr || payload.titleEn || 'TAKI';
  const body  = payload.body  || payload.bodyAr  || payload.bodyEn  || '';
  const data  = payload.data || {};
  // v15.79 — الوجهةُ تُفحَص عند المَصدر أيضاً، فلا يُخزَّن في الإشعار نفسه
  // عنوانٌ يخرج من الموقع.
  const url   = safePath(data.dealId ? `/deal/${data.dealId}` : data.url) || '/profile';

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
  // 🔴 v15.79 — كان الرابطُ يُسلَّم إلى `c.navigate()` و`openWindow()` **بلا أي
  // فحصٍ إطلاقاً**، وهو يأتي من بيانات الإشعار (`meta_data`). الشكلُ يُفحَص هنا
  // أيضاً لا في المَصدر وحده: إشعاراتٌ قديمة ما زالت على الأجهزة.
  const url = safePath(event.notification.data && event.notification.data.url) || '/';
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
