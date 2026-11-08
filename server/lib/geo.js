/**
 * lib/geo.js — مسافات، روابط/إحداثيات قوقل ماب، حساب الوقت/المسافة بالسيارة،
 * وحساب المتبقّي زمنياً للعروض. أدوات نقيّة مستخرَجة من bot.js v11.72.
 */

const { tr } = require('./i18n');   // request-scoped translation (ar/en) — v11.85
// 🪤 قراءةُ الجسم موضعٌ واحدٌ للمشروع كلّه (`lib/httpDeadline.js`): كانت هنا
//    نسخةٌ ثانية، ونسختان تنحرفان — وهذا بالضبط ما كلّف `chatView.js`.
const { readCapped } = require('./httpDeadline');

function haversineKm(la1, lo1, la2, lo2) {
    const R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180,
        a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const fmtKm = km => km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;

// تحليل "lat,lng" مكتوبة مباشرة.
function parseLatLng(text) {
    const m = String(text).match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (m) { const la = +m[1], ln = +m[2]; if (Math.abs(la) <= 90 && Math.abs(ln) <= 180) return { lat: la, lng: ln }; }
    return null;
}
// استخراج إحداثيات من رابط قوقل ماب (عدة أنماط — تشمل أنماط الروابط المختصرة بعد الفكّ).
function extractFromMapsUrl(url) {
    try {
        const u = decodeURIComponent(String(url));
        let m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);                                                     if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/[?&](?:q|query|destination|center|ll|sll|saddr|daddr|viewpoint)=(-?\d+\.\d+),(-?\d+\.\d+)/); if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);                                                     if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/!8m2!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);                                                 if (m) return { lat: +m[1], lng: +m[2] };
        m = u.match(/\[(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})\]/);                                     if (m) return { lat: +m[1], lng: +m[2] };  // JSON array in page body
        m = u.match(/(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})/);                                            if (m) return { lat: +m[1], lng: +m[2] };
    } catch { /* ignore */ }
    return null;
}
// ═══════════════════════════════════════════════════════════════════════════
//  v15.79 — موضعُ القرار الوحيد: مَن يجوز جلبُه، وكم بايتاً، وإلى متى.
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 **الكلفة مقيسة لا مفترضة.** رسالةٌ نصّيةٌ واحدة من غريبٍ على تيليجرام —
//    بلا حساب تاكي ولا ربط — كانت تقتل عمليّةَ البوت كلّها: جلسةُ الغريب
//    `step:'idle'` فيدخل فرعُ الموقع، و`clearTimeout` كان **قبل** قراءة
//    الجسم فتُلغى مهلةُ الثماني ثوانٍ لحظةَ وصول الترويسات، ثم `r.text()`
//    يُجمّع بثّاً مفتوحاً بلا سقف. قِيس على خادمٍ معاديّ محلّيّ:
//    `RESULT <NEVER-RETURNED> elapsed_s 25.0+ rss_before_MiB 34 rss_peak_MiB 761`
//    وRender المجّانيّة ٥١٢ م.ب ⇒ قتلٌ بنظام التشغيل قبل الثانية العاشرة،
//    ولا يُمسكه `uncaughtException`. وتموت معها حلقاتُ الإشعارات والبريد
//    والمخزون. فالعلاجُ نصفان لا نصف: المهلة في `finally` **و**سقفُ بايتات.
//
// 🔴 **ولا قائمةَ مضيفين كانت أصلاً.** `redirect:'follow'` + فحصُ نصٍّ على
//    الرابط كلّه (`?q=` أو `/maps`) جعل البوت وكيلَ GET مفتوحاً إلى
//    `127.0.0.1` و`169.254.169.254` وشبكةِ جدة الخاصّة `10.0.1.0/24`.
//    🪤 والقرار هنا **وحده**: كان في `bot.js` تعبيرٌ نمطيٌّ ثانٍ يحرس
//       المدخل، و`sellerDeals.js`/`whatsapp.js` تناديان بلا أيّ حارس —
//       أي ثلاثةُ أبوابٍ لبابٍ واحد. (درسُ `chatView.js`: نسختان تنحرفان.)
//    🪤 ودرسُ v14.71: حارسٌ بـ`[^/]*` يقبل `https://evil-takisa.net/`.
//       فالمطابقةُ هنا **على اسم المضيف بعد `new URL`**، مساواةً تامّة أو
//       لاحقةً **مثبَّتةً بالنقطة** — و`evil-google.com` يُرفض لأنه لا
//       ينتهي بـ`.google.com`، و`google.com.evil.test` لأنه لا يساويه.
//    🪤 و**كلُّ قفزة** تُفحص: رابطُ جوجل المختصر يُنشئه أيُّ أحدٍ ويوجّهه
//       حيث شاء، فالفحصُ الأوّل وحده يحرس البابَ ويترك النافذة.
//
// 🪤 ونظيرُها على الويب `api/resolve-map.js` (حُصّن في v14.54 ولم يُنقل
//    الدرسُ إلى البوت). ولا يُستورَد من هنا: Render تنشر `rootDir: server`
//    فلا يوجد `api/` في شجرة التشغيل إطلاقاً.
const MAP_HOSTS = [
    'maps.app.goo.gl', 'goo.gl', 'g.co',
    'google.com', 'google.com.sa', 'google.co.uk', 'google.ae',
];
const MAX_BODY = 512 * 1024;   // سقفُ جسمِ الصفحة — الإحداثيّة في أوّلها دائماً
const MAX_HOPS = 3;

/**
 * 🪤 الفحصُ على النصّ (`/^https?:\/\/127\./`) ليس فحصاً: `127.1` و
 *    `2130706433` و`0x7f000001` كلُّها المضيفُ المحلّيّ ولا يطابقها.
 *    (منسوخٌ سلوكاً من `api/resolve-map.js` — نفس الحالات مُختبَرة هناك.)
 */
function isPrivateHost(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.includes(':')) return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;   // بيانات وصف السحابة
        return false;
    }
    // شكلٌ رقميّ غير منقّط (عشري/ثماني/ستّ عشري) = تحايلٌ لا عنوانُ خرائط.
    if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true;
    return false;
}

/** يُرجع كائن URL إن جاز جلبُه، و`null` بأيّ سببٍ آخر — قبل فتح أيّ مقبس. */
function mapUrlOk(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch { return null; }
    if (u.protocol !== 'https:') return null;      // لا http: ولو لمضيفٍ مسموح
    if (isPrivateHost(u.hostname)) return null;
    const h = u.hostname.toLowerCase();
    const allowed = MAP_HOSTS.some(d => h === d || h.endsWith('.' + d));
    return allowed ? u : null;
}

// يقبل إحداثيات مباشرة، رابط ماب كامل، أو رابط قصير (maps.app.goo.gl / goo.gl/maps —
// يتبعه ويحلّله). v11.95: ترويسات تتجاوز صفحة الموافقة (consent) + تحليل
// العنوان النهائي ثم جسم الصفحة، لأن الروابط المختصرة كانت تفشل في تيليجرام.
async function resolveGoogleLocation(text) {
    const t = String(text || '').trim();
    const direct = parseLatLng(t);       if (direct) return direct;
    const inUrl  = extractFromMapsUrl(t); if (inUrl) return inUrl;
    let u = mapUrlOk(t);
    if (!u) return null;                 // ← القرارُ كلُّه هنا، قبل أيّ شبكة
    // 🪤 والمهلةُ تُسلَّح مرّةً واحدةً على **كلّ** القفزات: مهلةٌ لكلّ قفزة
    //    تجمع ثلاثةَ أضعافِ ما ينتظره المستخدم.
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    try {
        for (let hop = 0; hop < MAX_HOPS; hop++) {
            const r = await fetch(u.toString(), { redirect: 'manual', signal: ctrl.signal, headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'Cookie': 'CONSENT=YES+cb',   // يتجاوز صفحة موافقة قوقل في بعض المناطق
            } });
            const loc = (r.status >= 300 && r.status < 400) ? r.headers.get('location') : null;
            if (loc) {
                try { await r.body?.cancel(); } catch { /* بلا جسم */ }
                const next = mapUrlOk(new URL(loc, u).toString());
                if (!next) return null;      // ← تحويلٌ خرج من القائمة: يُوقف ولا يُتبع
                u = next;
                const fromHop = extractFromMapsUrl(u.toString()); if (fromHop) return fromHop;
                continue;
            }
            const fromFinal = extractFromMapsUrl(r.url || u.toString()); if (fromFinal) return fromFinal;
            return extractFromMapsUrl(await readCapped(r, MAX_BODY));
        }
        return null;
    } catch { return null; /* شبكة/مهلة → لا موقع */ }
    finally { clearTimeout(to); }          // ← تُغطّي الجسمَ لا الترويسات
}

// v13.66 — رابط «بحث بالاسم» في قوقل ماب: أي رابط بحث لا يحمل زوج إحداثيات.
// (`search/?api=1&query=24.7,46.6` بحثٌ بإحداثيات = مكان دقيق، فلا يُهمَل.)
function isNameSearchLink(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    if (!/google\.[^/]+\/maps\/search/i.test(u)) return false;
    let dec = u; try { dec = decodeURIComponent(u); } catch { /* يبقى كما هو */ }
    return !/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/.test(dec);
}

// رابط مكان قوقل (فتح موقع العرض). يقبل صف عرض أو {map_lat,map_lng,google_maps_link}.
//
// v13.66 — نُقض قرار v12.04. كان يفضّل «رابط بحث بالاسم» (اسم المول + المدينة)
// على الإحداثيات بحجّة أن قوقل يثبّت المكان الحقيقي بدقة. الواقع: البحث بالاسم
// يفتح **صفحة نتائج** لا مكاناً، ونجاحه رهن فهرسة قوقل لذلك المول — «الباحة مول»
// نجح و«كادي مول» فشل (بلاغ ناصر)، وهذا وحده يكفي: سلوك لا يمكن التنبؤ به.
// القاعدة الآن: الإحداثي يفوز، ولا يُحترم الرابط المحفوظ إلا إن كان رابط مكانٍ
// حقيقي لصقه التاجر بنفسه. نفس القاعدة حرفياً في الويب (src/utils/mapLinks.ts).
function placeLink(d) {
    const saved = d.google_maps_link ? String(d.google_maps_link).trim() : '';
    if (d.map_lat != null && d.map_lng != null) {
        if (saved && !isNameSearchLink(saved)) return saved;
        return `https://www.google.com/maps/search/?api=1&query=${d.map_lat},${d.map_lng}`;
    }
    return saved || null;
}
// رابط اتجاهات قيادة قوقل (ملاحة فعلية عند الفتح).
function dirLink(d, geo) {
    const saved = d.google_maps_link ? String(d.google_maps_link).trim() : '';
    if (d.map_lat == null || d.map_lng == null) return saved || null;
    const org = geo ? `&origin=${geo.lat},${geo.lng}` : '';
    return `https://www.google.com/maps/dir/?api=1${org}&destination=${d.map_lat},${d.map_lng}&travelmode=driving`;
}
// مسافة/وقت طريق فعلي عبر OSRM (ميزانية 2.5s) مع تقدير خطّي احتياطي.
async function driveInfo(geo, d) {
    if (!geo || d.map_lat == null || d.map_lng == null) return null;
    const straight = haversineKm(geo.lat, geo.lng, d.map_lat, d.map_lng);
    try {
        const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 2500);
        // 🪤 و`clearTimeout` كان **قبل** `r.json()` هنا أيضاً: نفسُ عيبِ
        //    `resolveGoogleLocation` بدرجةٍ أخفّ — العنوانُ ليس بيد المستخدم،
        //    لكن `router.project-osrm.org` طرفٌ ثالثٌ مجّانيّ يتعلّق جسمُه.
        try {
            const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${geo.lng},${geo.lat};${d.map_lng},${d.map_lat}?overview=false`, { signal: ctrl.signal });
            const j = JSON.parse(await readCapped(r, MAX_BODY) || "null"); const rt = j && j.routes && j.routes[0];
            if (rt) return { km: rt.distance / 1000, min: Math.max(1, Math.round(rt.duration / 60)), straight, est: false };
        } finally { clearTimeout(to); }
    } catch { /* OSRM down / slow → estimate */ }
    const km = straight * 1.3; return { km, min: Math.max(1, Math.round(km / 0.6)), straight, est: true };
}

// المتبقّي زمنياً لعرض مدّة/ساعات (يبدأ العدّ عند انطلاقه).
function remainingText(d) {
    if (!d.expires_in_minutes) return null;
    const start = Math.max(Number(d.starts_at) || 0, Number(d.created_at) || 0);
    let diff = start + d.expires_in_minutes * 60000 - Date.now();
    if (diff <= 0) return null;
    const day = Math.floor(diff / 86400000); diff -= day * 86400000;
    const hr = Math.floor(diff / 3600000); diff -= hr * 3600000;
    const mn = Math.floor(diff / 60000);
    if (day > 0) return tr('dur_day', day) + (hr ? tr('dur_join_hour', hr) : '');
    if (hr > 0)  return tr('dur_hour', hr) + (mn ? tr('dur_join_min', mn) : '');
    return tr('dur_min', mn);
}
// لحظة الانتهاء الدقيقة لعرض مدّة (لعرض التاريخ+الوقت الحقيقي للانتهاء).
function durationEndsAt(d) {
    if (!d.expires_in_minutes) return null;
    const start = Math.max(Number(d.starts_at) || 0, Number(d.created_at) || 0);
    if (!start) return null;
    return start + d.expires_in_minutes * 60000;
}

module.exports = {
    haversineKm, fmtKm, parseLatLng, extractFromMapsUrl, resolveGoogleLocation,
    placeLink, dirLink, driveInfo, remainingText, durationEndsAt,
};
// تُصدَّر للاختبار وحده: ضابطُ أمانٍ بلا اختبارٍ سالب ضابطٌ مجهول.
module.exports._internals = { mapUrlOk, isPrivateHost, MAP_HOSTS, MAX_BODY, MAX_HOPS };
