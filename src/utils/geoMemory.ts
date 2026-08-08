/**
 * ذاكرة الموقع (v13.79) — «اسأل مرة واحدة، ثم اعرف».
 *
 * بلاغ ناصر: «في كل مرة أطلب يطلبني أفعّل الموقع… أريده مثل تطبيقات التوصيل».
 * السبب لم يكن الصلاحية نفسها — المتصفح يتذكّرها — بل أن التطبيق كان **ينسى
 * الإحداثيات** عند كل فتح: `liveLocation` يبدأ `null` في كل جلسة، فكل صفحة
 * تعتمد عليه (تفاصيل العرض، حولي، المسافات) تعرض دعوة «فعّل موقعك» في أول
 * ثوانٍ — أو دائماً إن كان داخل مبنى ولم يصل تثبيت GPS.
 *
 * الحلّ هو ما تفعله تطبيقات التوصيل بالضبط: **آخر موقع معروف يُحفظ محلياً**
 * ويُستعاد فوراً عند الفتح، فيبدأ التطبيق عارفاً أين المستخدم بلا سؤال ولا
 * انتظار، ثم يصحّحه المتتبّع الحيّ خلال ثوانٍ حين يصل تثبيت جديد.
 *
 * خصوصية: البيانات محليّة على الجهاز فقط (`localStorage`)، ولا تُرسل من هنا
 * إلى أي خادم — الكتابة إلى `users.lat/lng` تبقى في `AppContext` وللمشتري فقط.
 * ومسح بيانات المتصفح أو رفض الصلاحية يمسحها (`forgetFix`).
 */

export interface RememberedFix {
    lat: number;
    lng: number;
    /** طابع زمني (ms) لآخر تثبيت — يميّز «موقعي الآن» عن «آخر موقع معروف». */
    at: number;
}

const FIX_KEY = 'taki_last_fix';

/** بعد شهر يصير الموقع المحفوظ تخميناً لا معلومة — نتجاهله ونسأل من جديد. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** أحدث من هذا = «موقعي الآن»؛ أقدم = «آخر موقع معروف». */
export const FRESH_FIX_MS = 10 * 60 * 1000;

const isCoord = (lat: unknown, lng: unknown): boolean =>
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0); // (0,0) في المحيط = قراءة فاسدة لا موقع

/** آخر موقع معروف للمستخدم على هذا الجهاز، أو null إن لم يوجد/تقادم/فسد. */
export const readRememberedFix = (): RememberedFix | null => {
    try {
        const raw = localStorage.getItem(FIX_KEY);
        if (!raw) return null;
        const f = JSON.parse(raw);
        if (!f || !isCoord(f.lat, f.lng)) return null;
        const at = typeof f.at === 'number' && Number.isFinite(f.at) ? f.at : 0;
        if (at && Date.now() - at > MAX_AGE_MS) return null;
        return { lat: f.lat, lng: f.lng, at };
    } catch {
        return null; // وضع خاص / حصة ممتلئة — نكمل بلا ذاكرة
    }
};

/** احفظ تثبيتاً جديداً. يُستدعى من المتتبّع الحيّ عند كل قراءة مقبولة. */
export const rememberFix = (lat: number, lng: number): void => {
    if (!isCoord(lat, lng)) return;
    try {
        localStorage.setItem(FIX_KEY, JSON.stringify({ lat, lng, at: Date.now() }));
    } catch { /* تجاهل */ }
};

/** امسح الذاكرة — عند رفض صريح للصلاحية أو تسجيل خروج. */
export const forgetFix = (): void => {
    try { localStorage.removeItem(FIX_KEY); } catch { /* تجاهل */ }
};

/** هل التثبيت حديث بما يكفي ليُقال عنه «الآن»؟ */
export const isFreshFix = (at: number): boolean => !!at && Date.now() - at <= FRESH_FIX_MS;
