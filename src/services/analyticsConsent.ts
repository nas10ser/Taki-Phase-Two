import { supabase } from './supabaseClient';

/**
 * analyticsConsent — بوّابة واحدة يمرّ بها كل قياسٍ سلوكي (v14.82)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الثغرة، مقيسة لا مفترضة: سياسة الخصوصية تَعِد صراحةً بحقّ **سحب الموافقة**
 *    (القسم ٦)، وقسمُ الكوكيز يُحيل إلى «إعدادات متصفّحك لرفض هذه الملفّات».
 *    والقياسُ في تاكي **لا يمرّ بالكوكيز إطلاقاً**: أربعة مسارات تكتب مباشرةً
 *    إلى القاعدة عبر RPC —
 *      ١) `analyticsTracker`  → `record_analytics_events`  (سلوك داخل التطبيق)
 *      ٢) `searchTracker`     → أحداث البحث
 *      ٣) `track_app_open`    → فتح التطبيق ومصدره
 *      ٤) `siteVisit`         → الزيارة والمصدر وصفحة الهبوط
 *    فمن يتبع إرشادنا ويمنع الكوكيز **لا يُوقف شيئاً منها**. أي أن الوثيقة
 *    تَعِد بما لا يُنفَّذ — وهذا أسوأ من ألّا تَعِد.
 *
 * ما صار: مفتاحٌ واحد حقيقي. الحالة تُحفظ محلياً (فتعمل **للزائر** أيضاً، وهو
 * مُتتبَّعٌ فعلاً)، وتُزامَن مع `users.analytics_opt_out` لمن له حساب فتتبعه
 * بين أجهزته. والبوّابة تُفحص **قبل بناء أي حدث** لا قبل إرساله — فلا يُجمَّع
 * شيء في الذاكرة أصلاً.
 *
 * 🪤 والافتراضي «مفعّل» عمداً: القياس مجهولُ الهوية (لا اسم ولا بريد ولا عنوان
 *    إنترنت)، ونظام حماية البيانات السعودي يسمح به للمصلحة المشروعة —
 *    والوعد الذي يجب أن يُوفى هو **إمكان الإيقاف**، لا الإيقاف افتراضاً.
 * 🪤 وعند الإيقاف يُمحى معرّف الجلسة ومفاتيح إزالة التكرار من المتصفّح، وإلا
 *    بقي المعرّف نفسه في الجهاز فعاد القياس بنفس الهوية لحظة إعادة التفعيل.
 */

/** مفتاح واحد في `localStorage`. القيمة `'1'` تعني **موقوف**. */
const OPT_OUT_KEY = 'taki_analytics_off';

/** مفاتيح يخلّفها القياس في المتصفّح — تُمحى عند الإيقاف. */
const TRACE_KEYS = ['taki_an_sid', 'taki_an_seen', 'taki_visit_sent'];

/** حدثٌ داخليّ يُعلم المكوّنات بتغيّر الحالة (مفتاحان في شاشتين، حالةٌ واحدة). */
export const CONSENT_EVENT = 'taki:analytics-consent';

let cached: boolean | null = null;

/**
 * هل القياس مسموح الآن؟ **متزامنة عمداً** — تُنادى في مسارات ساخنة
 * (كل نقرة بطاقة)، فلا تحتمل انتظار شبكة.
 */
export const analyticsAllowed = (): boolean => {
    if (cached !== null) return cached;
    try {
        cached = localStorage.getItem(OPT_OUT_KEY) !== '1';
    } catch {
        cached = true;   // متصفّحٌ يمنع التخزين — لا نُعطّل القياس بسبب ذلك
    }
    return cached;
};

/** يُنظّف ما خلّفه القياس في هذا المتصفّح. */
const clearTraces = () => {
    for (const k of TRACE_KEYS) {
        try { localStorage.removeItem(k); } catch { /* تخزينٌ ممنوع */ }
        try { sessionStorage.removeItem(k); } catch { /* تخزينٌ ممنوع */ }
    }
};

/**
 * يضبط الحالة محلياً (فوراً) ثم يُزامنها مع الحساب إن وُجد.
 * @returns هل نجحت المزامنة مع الحساب؟ (محلياً تنجح دائماً)
 */
export const setAnalyticsAllowed = async (allowed: boolean): Promise<boolean> => {
    cached = allowed;
    try {
        if (allowed) localStorage.removeItem(OPT_OUT_KEY);
        else localStorage.setItem(OPT_OUT_KEY, '1');
    } catch { /* تخزينٌ ممنوع — تبقى الحالة في الذاكرة لهذه الجلسة */ }

    if (!allowed) clearTraces();

    try {
        window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { allowed } }));
    } catch { /* بيئة بلا window */ }

    // المزامنة مع الحساب: تُفشل بصمتٍ للزائر (لا جلسة) وهذا مقصود.
    try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess?.session?.user?.id) return true;
        const { error } = await supabase.rpc('set_analytics_opt_out', { p_off: !allowed });
        if (error) {
            console.warn('analyticsConsent: تعذّرت المزامنة مع الحساب:', error.message);
            return false;
        }
    } catch (e) {
        console.warn('analyticsConsent: تعذّرت المزامنة:', e);
        return false;
    }
    return true;
};

/**
 * عند الدخول: اختيارُ الحساب يسود على هذا الجهاز — فمن أوقف القياس من جواله
 * يجده موقوفاً على حاسبه. ولا يُنادى للزائر.
 *
 * 🪤 ولا يُكتب شيء في القاعدة من هنا: هذه قراءةٌ فقط. لو كتبنا حالة الجهاز
 *    إلى الحساب عند كل دخول، لدهس جهازٌ لم يُضبط قطّ اختيارَ جهازٍ ضُبط عمداً.
 */
export const syncAnalyticsConsentFromAccount = async (): Promise<void> => {
    try {
        const { data, error } = await supabase.rpc('get_analytics_opt_out');
        if (error || data === null || data === undefined) return;
        const off = data === true;
        cached = !off;
        try {
            if (off) localStorage.setItem(OPT_OUT_KEY, '1');
            else localStorage.removeItem(OPT_OUT_KEY);
        } catch { /* تخزينٌ ممنوع */ }
        if (off) clearTraces();
        try {
            window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { allowed: !off } }));
        } catch { /* بيئة بلا window */ }
    } catch { /* شبكة — تبقى الحالة المحلية */ }
};

/** للاختبار وحده: يُنسي الذاكرة المؤقّتة فتُعاد القراءة من التخزين. */
export const __resetAnalyticsConsentCache = () => { cached = null; };
