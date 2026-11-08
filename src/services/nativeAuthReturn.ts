/**
 * nativeAuthReturn.ts — استهلاكُ عودةِ المصادقة داخل تطبيقَي المتجرين (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلةُ المقيسة: مصادقةُ المتصفّح تعود إلى `window.location.origin`،
 * وهو داخل التطبيق `capacitor://localhost` (آيفون) أو `https://localhost`
 * (أندرويد) — عنوانٌ لا يبلغه أيُّ متصفّحٍ خارجيّ ولا يقبله GoTrue. والآن
 * تعود إلى `net.takisa.app://auth/callback`، ويُسلّمها `appUrlOpen` هنا.
 *
 * 🔴 **والنمطُ هنا implicit لا PKCE** — وهذا هو الفرقُ الذي يُبطل الحلَّ
 *    الخاطئ: `@supabase/auth-js` الافتراضُ فيه `flowType: 'implicit'`، و
 *    `supabaseClient.ts` لا يضبطه. ⇒ العودةُ تحمل
 *    `#access_token=…&refresh_token=…` في **التجزئة**، فالمطلوب
 *    `setSession` لا `exchangeCodeForSession`. (وتُركت الثانيةُ شبكةَ أمانٍ
 *    لو ضُبط النمطُ يوماً على PKCE — فيبقى المسارُ عاملاً بلا تعديلٍ ثانٍ.)
 *
 * 🪤 و`setSession` لا إعادةُ تحميلٍ: هي تُطلق `SIGNED_IN` عبر المستمع
 *    القائم في `AppContext`، فيجري تحميلُ الملفّ والتوجيهُ بنفس المسار
 *    الواحد — ولا يُخترَع مسارُ دخولٍ ثانٍ ينحرف عن الأوّل.
 *
 * 🪤 وملفٌّ مستقلٌّ عمداً، ويُحمَّل بـ`await import` من `index.tsx`: استيرادٌ
 *    ساكنٌ كان سيُدخله في حزمة دخولِ **كلّ زائرٍ على الويب** بلا فائدة
 *    (درسُ `@sentry/react` في v14.84)، و`AppContext` عند سقف السقّافة.
 */
import { supabase } from './supabaseClient';
import { markPasswordRecovery } from '../utils/passwordRecovery';

/**
 * تستهلك تجزئةَ العودة وتفتح الجلسة.
 * @param fragment نصُّ التجزئة (`#…`) أو الاستعلام (`?…`) كما وصل.
 * @returns `true` إن فُتحت جلسةٌ فعلاً.
 */
export async function consumeNativeAuthReturn(fragment: string): Promise<boolean> {
    const p = new URLSearchParams(String(fragment || '').replace(/^[#?]/, ''));

    // 🔴 والخطأُ يُقرأ أوّلاً: GoTrue يعيد `error`/`error_description` على نفس
    //    المخطَّط عند الإلغاء أو الرفض، وقراءةُ الرموز قبله تُنتج «لا شيء
    //    حدث» بدل سببٍ معروف.
    if (p.get('error') || p.get('error_description')) return false;

    const accessToken = p.get('access_token');
    const refreshToken = p.get('refresh_token');
    if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        if (error) return false;
        // 🪤 ومسارُ الاستعادة يُعلَن **قبل** التوجيه: بلا هذا العَلَم يرى
        //    `AuthRedirector` جلسةً صالحةً فيسحب المستخدمَ إلى الرئيسية
        //    بكلمته القديمة — وهو بلاغُ ناصر الذي بُني له `passwordRecovery`.
        if (p.get('type') === 'recovery') {
            markPasswordRecovery();
            window.history.pushState({}, '', '/register');
            window.dispatchEvent(new PopStateEvent('popstate'));
        }
        return true;
    }

    const code = p.get('code');
    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        return !error;
    }
    return false;
}
