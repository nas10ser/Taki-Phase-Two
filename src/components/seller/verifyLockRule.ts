import type { MyVerification } from '../../repositories/verificationRepository';

/**
 * قرارُ قفل التوثيق — خالصٌ بلا أي استيرادٍ قيميّ (v16.38)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 هذا أخطرُ قرارٍ في لوحة التاجر: قفلٌ خاطئٌ **يُرمِّد لوحةَ تاجرٍ مسموحٍ
 *    له** فيظنّ متجرَه معطّلاً، ولا رسالةَ تقول له إن الخطأ عندنا.
 *    فالشرطُ يطابق ما يفرضه الخادمُ حرفاً ولا يزيد:
 *      · `null`     ⇒ لم تُحسم الحالةُ بعد ⇒ **لا قفل** (لا ومضةَ رماد).
 *      · `off`      ⇒ التوثيقُ مُطفأ ⇒ لا قفل.
 *      · `advisory` ⇒ النشرُ مفتوحٌ تماماً ⇒ **لا قفل** (ترميدُه منعٌ مخترَع).
 *      · `required` + موثّق ⇒ لا قفل.
 *      · `required` + مهلةٌ انتقاليّةٌ سارية ⇒ لا قفل (امتيازٌ منحه الأدمن).
 *      · `required` + غيرُ موثّقٍ + لا مهلة ⇒ **قفل**.
 *
 * 🪤 و`mode` المُمرَّرُ هنا هو الوضعُ **الفعليُّ بعد أثر «وضع السفر»**
 *    (`my_verification_state` تُنزِّل `required` ⇐ `advisory` حين يُفعَّل)
 *    — فلا يُحسب الوضعُ المعلَنُ في الإعدادات مكانَه.
 * 🪤 و`now` يُمرَّر ولا يُقرأ من الساعة في الجسم: مهلةٌ منتهيةٌ بثانيةٍ لا
 *    تُقاس في اختبارٍ إن كانت الساعةُ مخبوءةً داخل الدالّة.
 * 🪤 وملفٌّ مستقلٌّ عمداً: `VerifyLock.tsx` يستورد السياقَ ومستودعَ التوثيق،
 *    فتحميلُه في Node يُنشئ عميلَ سوبابيس ويرمي «Missing Supabase environment
 *    variables» — فيصير القرارُ غيرَ قابلٍ للاختبار. وهنا `import type` وحده
 *    وهو يُمحى عند الترجمة.
 */
export const computeVerifyLock = (
    state: Pick<MyVerification, 'mode' | 'verified' | 'graceUntil'> | null,
    now: number,
): boolean => {
    if (!state) return false;
    if (state.mode !== 'required') return false;
    if (state.verified) return false;
    const graceAt = state.graceUntil ? new Date(state.graceUntil).getTime() : NaN;
    if (Number.isFinite(graceAt) && graceAt > now) return false;
    return true;
};
