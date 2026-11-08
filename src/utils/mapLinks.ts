/**
 * mapLinks.ts — روابط الخرائط في تاكي، بقاعدة واحدة لكل النظام (v13.66)
 *
 * ── المشكلة التي يسدّها (بلاغ ناصر: «عند وضع كادي مول يظهر بحث») ───────────
 * في v12.04 اتُّخذ قرار: حين يختار التاجر مولاً من القائمة نحفظ له رابط **بحث
 * بالاسم** («اسم المول + المدينة + السعودية») بدل الإحداثيات، بحجّة أن قوقل
 * «يثبّت المكان الحقيقي بدقة بدل دبّوس تقريبي». الافتراض خاطئ: البحث بالاسم
 * يفتح **صفحة نتائج** لا مكاناً، وكلما كان اسم المول شائعاً أو غير مفهرس عند
 * قوقل ضاع المستخدم — وهذا ما رآه ناصر في «كادي مول» بينما نجح «الباحة مول»
 * بالصدفة. والنتيجة غير قابلة للتنبؤ من مولٍ لآخر، وهذا وحده يكفي لرفضها.
 *
 * ── القاعدة المعتمدة الآن ─────────────────────────────────────────────────
 * ١. عندنا إحداثيات؟ → افتح **المكان** بالإحداثيات. دبّوس مضبوط دائماً.
 * ٢. الرابط المحفوظ رابط بحث بالاسم ولدينا إحداثيات؟ → **تُهمَل** ويُستعمل
 *    الإحداثي. (صفوف قديمة في القاعدة ما زالت تحمل روابط بحث — تُعالَج هنا
 *    بلا أي تعديل على البيانات.)
 * ٣. الرابط المحفوظ رابط مكان حقيقي (`/place/`، `maps.app.goo.gl`، أو فيه
 *    إحداثيات)؟ → يُحترم كما هو: التاجر لصقه بنفسه وهو أدقّ من أي اشتقاق.
 * ٤. لا إحداثيات ولا رابط → لا زرّ. لا نعرض زرّاً يقود إلى لا شيء.
 *
 * كل واجهة تعرض «الاتجاهات» أو «الخريطة» تمرّ من هنا — الويب والبوتان.
 *
 * ── v15.79: والرابطُ المحفوظ **لا يُفتح قبل أن يُثبَت أنه خريطةُ قوقل** ──────
 * 🔴 `google_maps_link` يكتبه التاجرُ نفسه (`deals_update_seller` و
 *    `users_update_admin` كلتاهما عمياءُ الأعمدة، ولا قيدَ `CHECK` على القاعدة)،
 *    وكان يُسلَّم حرفياً إلى `<a href>` تحت وسمٍ يقول «الاتجاهات عبر خرائط
 *    جوجل» ⇒ **تحويلٌ غيرُ مُتحقَّق من صفحةٍ موثوقة**: صفحةُ دخولٍ مزيّفة
 *    تحصد بريدَ المشتري وكلمتَه، والمستخدم يظنّ أنه ذاهبٌ إلى قوقل.
 * 🪤 ولا يُكتب الحارسُ بنمطٍ نصّيّ: CLAUDE.md تسجّل حارساً بـ`[^/]*` قَبِل
 *    `https://evil-takisa.net/`. فالتحليلُ بـ`new URL`، والمقارنةُ **تطابقٌ
 *    تامّ أو لاحقةٌ مثبّتةٌ بالنقطة** (`h === host || h.endsWith('.' + host)`)،
 *    و`https:` وحدها — ويُجرَّب سالباً قبل التصديق.
 */

export interface MapPoint {
    lat?: number | null;
    lng?: number | null;
    googleMapsLink?: string | null;
}

const hasCoords = (p: MapPoint): p is MapPoint & { lat: number; lng: number } =>
    typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && !(p.lat === 0 && p.lng === 0);

/**
 * رابط «بحث بالاسم» في قوقل ماب — أي رابط بحث لا يحمل إحداثيات.
 * `search/?api=1&query=24.7,46.6` بحثٌ **بإحداثيات** فهو مكان دقيق ولا يُهمَل،
 * بينما `search/?api=1&query=كادي مول جازان` صفحة نتائج.
 */
export const isNameSearchLink = (url?: string | null): boolean => {
    const u = String(url || '').trim();
    if (!u) return false;
    if (!/google\.[^/]+\/maps\/search/i.test(u)) return false;
    // فيه زوج إحداثيات؟ إذن هو مكان محدّد لا نتيجة بحث.
    return !/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/.test(decodeURIComponent(u));
};

/**
 * مضيفاتٌ **لا تخدم إلا الخرائط** — أيُّ مسارٍ عليها مقبول، فروابطُ المشاركة
 * القصيرة (`maps.app.goo.gl/AbC`) بلا مسارٍ دالّ أصلاً.
 */
const MAP_ONLY_HOSTS = ['maps.app.goo.gl', 'maps.google.com', 'maps.google.com.sa'];
/**
 * مضيفاتُ قوقل **العامّة** — تُقبل بمسار `/maps` وحده.
 * 🔴 وهذا ليس تزيّداً: `*.google.com` يحوي `sites.google.com` الذي **يستضيف
 *    صفحةَ المهاجم نفسها** بلا أيّ وسيط، و`www.google.com/url?q=` محوّلٌ
 *    مفتوح. فلاحقةُ النقطة وحدها تُبقي الثغرةَ مفتوحةً باسم قوقل.
 */
const GOOGLE_HOSTS = ['google.com', 'google.com.sa', 'goo.gl'];

/** هل هذا رابطُ خرائطِ قوقل حقيقيّ؟ (الموضع الوحيد الذي يُسأل عن ذلك) */
export const isMapUrl = (url?: string | null): boolean => {
    const s = String(url || '').trim();
    if (!s) return false;
    let u: URL;
    try { u = new URL(s); } catch { return false; }
    if (u.protocol !== 'https:') return false;          // لا `javascript:` ولا `data:` ولا `http:`
    const h = u.hostname.toLowerCase();
    const is = (host: string) => h === host || h.endsWith('.' + host);
    if (MAP_ONLY_HOSTS.some(is)) return true;
    // `/maps` أو `/maps/...` — لا `/maps-evil`.
    const onMapsPath = u.pathname === '/maps' || u.pathname.startsWith('/maps/');
    return GOOGLE_HOSTS.some(is) && onMapsPath;
};

/** رابط يفتح المكان على الخريطة، أو '' إن لم يكن لدينا ما يُفتح. */
export const placeLink = (p: MapPoint): string => {
    // الرابطُ المحفوظ لا يُستعمل إلا إن كان خريطةَ قوقل؛ وإلّا فهو كالعدم.
    const saved = isMapUrl(p.googleMapsLink) ? String(p.googleMapsLink).trim() : '';
    if (hasCoords(p)) {
        // رابط التاجر يفوز إلا أن يكون بحثاً بالاسم — عندها الإحداثي أوثق.
        if (saved && !isNameSearchLink(saved)) return saved;
        return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    }
    return saved;   // لا إحداثيات: الرابط المحفوظ هو كل ما عندنا (ولو كان بحثاً)
};

/** رابط ملاحة فعلية (اتجاهات القيادة) — نفس القاعدة. */
export const directionsLink = (p: MapPoint): string => {
    if (hasCoords(p)) {
        return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
    }
    return isMapUrl(p.googleMapsLink) ? String(p.googleMapsLink).trim() : '';
};

/** إحداثيات صالحة للرسم على خريطة داخل التطبيق (أو null). */
export const coordsOf = (p: MapPoint): { lat: number; lng: number } | null =>
    hasCoords(p) ? { lat: p.lat, lng: p.lng } : null;
