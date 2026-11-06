/**
 * pgError — قراءةُ رمز خطأ القاعدة بعد v15.53
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي وُلد منه هذا الملفّ، مقيساً على الإنتاج: **PostgREST يُترجم
 *    `P0001` وحدها إلى ٤٠٠ ومعها الرسالة؛ وكلُّ `P00xx` غيرها ⇒ ٥٠٠ ونصٌّ
 *    عامّ `Something went wrong` بـ`text/plain`.** وفي المنصّة ٢٤ رمزاً في
 *    ٥٣ موضعاً — أي أن كلَّ حارسٍ كُتبت له رسالةٌ عربيّةٌ دقيقة كان يقول
 *    للمستخدم جملةً عمياء: نفادُ الكمّية · مهلةُ الختم · التوصيلُ خارج
 *    النطاق · حدُّ الطلبات · ومتجرٌ غير موثَّق (شكوى ناصر).
 *
 * فصار الرمزُ المرفوع `P0001` دائماً، والرمزُ **الآليّ** في `hint`.
 * وهذه الدالّةُ تقرأ الاثنين فلا يهمّ أين سكن الرمز.
 *
 * 🪤 ولا يُقرأ `code` وحده بعد اليوم: سيكون `P0001` لكلّ شيء.
 */
export const pgCode = (e: unknown): string => {
    const o = (e || {}) as Record<string, unknown>;
    const hint = typeof o.hint === 'string' ? o.hint.trim() : '';
    if (/^P0\d{3}$/.test(hint)) return hint;
    const code = typeof o.code === 'string' ? o.code.trim() : '';
    return code;
};

/** هل هذا الخطأُ من الرمز المطلوب؟ يقبل `code` القديم و`hint` الجديد. */
export const isPgCode = (e: unknown, code: string): boolean => pgCode(e) === code;

export default pgCode;
