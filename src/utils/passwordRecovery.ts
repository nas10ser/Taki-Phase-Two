/**
 * passwordRecovery.ts — مصدر واحد يقيني لحالة «نحن في مسار إعادة تعيين كلمة المرور»
 * ---------------------------------------------------------------------------
 * 🔴 المشكلة التي يحلّها (بلاغ ناصر: «الرابط من الإيميل دخّلني الموقع مباشرة»):
 *
 * رابط الاستعادة يعود إلى `/register#access_token=…&type=recovery`. وكان
 * كشفُ هذا الوضع يعتمد على حدث `PASSWORD_RECOVERY` من supabase-js — وهو حدث
 * **يقع مرّة واحدة عند تهيئة العميل**، أي غالباً **قبل** أن تُركَّب صفحة
 * التسجيل ويُسجَّل مستمعُها. فيُفوَّت الحدث، ولا يُفتح وضع التعيين، ويبقى
 * للمستخدم جلسةٌ صالحة ⇒ يسحبه `AuthRedirector` إلى الرئيسية بكلمته القديمة.
 *
 * ولم يكن ذلك التحويل الوحيد: `AuthRedirector` يحوّل أيضاً بمجرد رؤية
 * `access_token` في التجزئة — وتجزئةُ رابط الاستعادة تحتويه.
 *
 * ✅ الحلّ: **لا نعتمد على توقيت أي حدث**. نقرأ العنوان **لحظة تحميل هذه
 * الوحدة** (قبل أن يمسح supabase-js التجزئة عند `detectSessionInUrl`)، ونثبّت
 * النتيجة في `sessionStorage` فتبقى بعد مسح التجزئة وبعد أي إعادة تركيب أو
 * إعادة تحميل داخل نفس التبويب. وتُمحى **فقط** بعد حفظ كلمة المرور فعلاً أو
 * بمغادرة المستخدم الشاشة صراحةً.
 *
 * لماذا `sessionStorage` لا `localStorage`: الحالة تخصّ هذا التبويب وهذه
 * المحاولة. `localStorage` كان سيُبقي المستخدم عالقاً في وضع التعيين على كل
 * تبويب وفي كل زيارة لاحقة لو انقطع في المنتصف.
 */

const KEY = 'taki_pw_recovery';

/** هل يحمل العنوان الحالي علامة مسار الاستعادة؟ */
const urlSaysRecovery = (): boolean => {
    try {
        // GoTrue يعيد: /register#access_token=…&type=recovery&…
        // ونفحص `search` أيضاً تحسّباً لأي تهيئة تضع المعاملات في الاستعلام.
        const hay = `${window.location.hash || ''}&${window.location.search || ''}`;
        return /[?&#]type=recovery(?:&|$)/.test(hay);
    } catch {
        return false;
    }
};

// ── يُنفَّذ مرّة عند أول استيراد، قبل أن تُمسح التجزئة ────────────────────────
try {
    if (urlSaysRecovery()) sessionStorage.setItem(KEY, '1');
} catch { /* وضع التصفّح الخاص قد يمنع التخزين — نسقط للفحص المباشر أدناه */ }

/** يرفع العَلَم يدوياً (يستدعيه مستمع PASSWORD_RECOVERY كخطّ ثانٍ). */
export const markPasswordRecovery = (): void => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* تجاهل */ }
};

/**
 * هل نحن داخل مسار إعادة تعيين كلمة المرور؟
 * يقرأ المخزَّن أولاً، ويعود للعنوان إن تعذّر التخزين (تصفّح خاص).
 */
export const isPasswordRecovery = (): boolean => {
    try {
        if (sessionStorage.getItem(KEY) === '1') return true;
    } catch { /* تجاهل */ }
    return urlSaysRecovery();
};

/** يُمحى بعد حفظ كلمة المرور، أو بمغادرة المستخدم الشاشة صراحةً. */
export const clearPasswordRecovery = (): void => {
    try { sessionStorage.removeItem(KEY); } catch { /* تجاهل */ }
};
