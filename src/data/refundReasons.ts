/**
 * refundReasons — رموزُ مسار الاسترداد بعبارةٍ يفهمها التاجر (v15.85)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **لماذا خرج الكتالوجُ إلى ملفٍّ مستقلّ:** كان داخل `RefundButton.tsx`
 *    وحده، و`RefundPanel.tsx` — وهو شاشةُ البتّ في طلبات الاسترداد — يطبع
 *    الرمزَ الخام: «⚠️ NO_REQUEST» · «⚠️ ZERO_AMOUNT». رمزٌ لاتينيٌّ في وجه
 *    تاجرٍ على **مسار المال** هو أسوأُ موضعٍ ممكن لنصٍّ لا يُفهم.
 *
 * 🪤 و`reasonText` **لا تُعيد الرمزَ أبداً** حتى لو لم تعرفه: ترتدّ إلى جملةٍ
 *    بشريّة. فكلُّ رمزٍ جديدٍ يُضاف في القاعدة غداً يصل التاجرَ مفهوماً لا
 *    خاماً — وهو عكسُ ما كان: قائمةٌ تُجمّل المعروف وتفضح المجهول.
 *
 * 🪤 والرموزُ مقروءةٌ من نصّ الدوالّ الحيّ لا من الذاكرة:
 *    `resolve_booking_refund` و`taki_claim_booking_refund` ترفعان
 *    `AUTH_REQUIRED · NOT_FOUND · NOT_MERCHANT · NOT_PAID · NO_PAYMENT_REF ·
 *     ALREADY_REFUNDED · REFUND_IN_FLIGHT · ZERO_AMOUNT · AMOUNT_ABOVE_INVOICE`.
 */

export interface Reason { ar: string; en: string }

export const REFUND_REASONS: Record<string, Reason> = {
    // ── بوّابةُ الدفع ──────────────────────────────────────────────────────
    GATEWAY_UNAVAILABLE: { ar: 'بوّابة الدفع غير مفعّلة أو مفاتيحها ناقصة — افتح «💳 بوابة الدفع» وتحقّق منها.', en: 'Your payment gateway is not active or its keys are missing — open «Payment gateway» and check.' },
    // 🪤 الرمزُ الذي تُرسله دالّةُ الحافة هو `REFUND_NOT_SUPPORTED` — وكان
    //    المفتاح `REFUND_UNSUPPORTED`، فلا يُطابق أبداً وتضيع أنفعُ رسالة.
    REFUND_NOT_SUPPORTED: { ar: 'مزوّد الدفع لديك لا يدعم الردّ الآلي — ردّ المبلغ من لوحة مزوّدك ثمّ سجّله هنا بزرّ «تأكيد ردّ المبلغ».', en: 'Your provider does not support automated refunds — refund from their dashboard, then record it here.' },
    PROVIDER_CHANGED: { ar: 'بدّلتَ مزوّد الدفع بعد هذا الطلب، ومفاتيحك الجديدة لا تعرف تلك العملية — ردّ المبلغ من لوحة مزوّدك السابق ثمّ سجّله هنا.', en: 'You changed payment providers after this order, so your new keys do not know that transaction — refund from your previous provider, then record it here.' },

    // ── هويّةُ الطلب وحالتُه ───────────────────────────────────────────────
    NOT_YOUR_ORDER: { ar: 'هذا الطلب ليس على متجرك.', en: 'This order does not belong to your store.' },
    NOT_MERCHANT: { ar: 'هذا الطلب ليس على متجرك.', en: 'This order does not belong to your store.' },
    BOOKING_NOT_FOUND: { ar: 'لم يُعثر على هذا الطلب.', en: 'This order was not found.' },
    NOT_FOUND: { ar: 'لم يُعثر على هذا الطلب. حدّث الصفحة.', en: 'This order was not found. Refresh the page.' },
    AUTH_REQUIRED: { ar: 'انتهت جلستك. اخرج ثمّ ادخل مرّةً أخرى وأعِد المحاولة.', en: 'Your session expired. Sign out, sign back in, and try again.' },
    ALREADY_REFUNDED: { ar: 'هذا الطلب مستردّ من قبل — لا يُردّ مرّتين.', en: 'This order was already refunded — it cannot be refunded twice.' },
    ALREADY_CLAIMING: { ar: 'هناك نداءُ ردٍّ جارٍ على هذا الطلب الآن. انتظر نتيجته قبل إعادة المحاولة.', en: 'A refund call is already in flight for this order. Wait for its result.' },
    REFUND_IN_FLIGHT: { ar: 'هناك نداءُ ردٍّ جارٍ على هذا الطلب الآن. انتظر نتيجته — ولا تضغط مرّةً أخرى.', en: 'A refund call is already in flight for this order. Wait for its result — do not press again.' },
    NOT_PAID: { ar: 'هذا الطلب غير مدفوع إلكترونياً — لا مبلغ يُردّ.', en: 'This order was not paid online — there is nothing to refund.' },
    NO_PAYMENT_REF: { ar: 'لا يحمل هذا الطلب مرجع دفعٍ من المزوّد، فلا شيء يُردّ عليه آلياً.', en: 'This order carries no provider payment reference, so it cannot be refunded automatically.' },

    // ── المبلغ وطلبُ المشتري ──────────────────────────────────────────────
    ZERO_AMOUNT: { ar: 'مبلغ الطلب صفر — لا شيء يُردّ.', en: 'The order amount is zero — nothing to refund.' },
    AMOUNT_ABOVE_INVOICE: { ar: 'المبلغ المُدخَل أكبر من إجمالي الفاتورة. أدخل مبلغاً لا يتجاوزها.', en: 'The amount entered is larger than the invoice total. Enter an amount within it.' },
    NO_REQUEST: { ar: 'لا يوجد طلب استرداد قائم على هذا الطلب الآن. حدّث الصفحة.', en: 'There is no open refund request on this order. Refresh the page.' },
    BAD_ACTION: { ar: 'إجراءٌ غير معروف. حدّث الصفحة وأعِد المحاولة.', en: 'Unknown action. Refresh the page and try again.' },

    // ── الشبكةُ والمعدّل ──────────────────────────────────────────────────
    RATE_LIMITED: { ar: 'محاولات كثيرة في وقت قصير — انتظر دقيقة ثمّ أعِد المحاولة.', en: 'Too many attempts — wait a minute and try again.' },
    NETWORK: { ar: 'تعذّر الوصول للخادم. الطلب **لم يُنفَّذ**؛ تحقّق من اتصالك وأعِد المحاولة.', en: 'Could not reach the server. The refund was NOT executed; check your connection and retry.' },
};

/**
 * نصُّ السبب — **ولا يُعاد الرمزُ الخام أبداً.**
 * 🪤 والارتدادُ ليس تجميلاً: رمزٌ جديدٌ في هجرةٍ قادمة سيصل التاجرَ لاتينياً
 *    خاماً لو كانت القائمةُ وحدها هي الجواب. فالمجهولُ يُقال بشريّاً ويُسجَّل
 *    في `logger` للمطوّر.
 */
export const reasonText = (code: string | null | undefined, isRTL: boolean): string => {
    const key = String(code || '').trim().toUpperCase();
    const hit = REFUND_REASONS[key];
    if (hit) return isRTL ? hit.ar : hit.en;
    // نصٌّ عربيٌّ وصلَنا من الخادم بدل رمز ⇒ يُعرض كما هو (مكتوبٌ للتاجر).
    const raw = String(code || '').trim();
    const ar = (raw.match(/[ء-ي]/g) || []).length;
    const la = (raw.match(/[A-Za-z]/g) || []).length;
    if (ar >= 8 && ar > la) return raw;
    return isRTL
        ? 'لم تتمّ العمليّة. حدّث الصفحة وأعِد المحاولة، وإن تكرّر فأبلِغنا من «📣 الشكاوى».'
        : 'The operation did not complete. Refresh and retry; if it persists, report it from «Complaints».';
};

export default REFUND_REASONS;
