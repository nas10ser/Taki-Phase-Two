/**
 * «تعذّر تفعيل الاشتراك: payment_not_confirmed» — جملةٌ مفهومةٌ بدل رمز
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦): «عند رفع الباقة يتعذّر التفعيل».
 *
 *    وقِيس السببُ كاملاً قبل أيّ تعديل:
 *    ① `paymentService.initiateMoyasarPayment` **محاكاةٌ** ترجع نجاحاً بعد
 *       ثانيةٍ ونصف بلا أيّ اتّصالٍ ببوّابة (موثّقٌ في جسمها: "Simulation").
 *    ② ثمّ `subscribe_self_to_package` تسأل `_taki_sub_payment_ok` التي
 *       تشترط صفَّ دفعٍ حقيقيّاً بمرجعِ بوّابةٍ غيرِ فارغ خلال ساعتين —
 *       وهو **حارسٌ صحيحٌ وُضع في v15.40** بعد أن كان أيُّ تاجرٍ يمنح نفسه
 *       أيَّ باقةٍ مجّاناً من الطرفيّة. فلا يُمسّ.
 *    ⇒ النتيجةُ الحتميّة: «❌ تعذّر تفعيل الاشتراك: payment_not_confirmed».
 *
 * 🪤 والرمزُ الإنجليزيُّ الخام مخالفةُ قاعدةٍ قائمة: **لا لغةَ قواعدِ بياناتٍ
 *    في رسالةٍ يراها المستخدم**. وكلُّ رسالةٍ هنا تنتهي بخطوةٍ يفعلها.
 */

export type SubscribeFailure =
    | 'payment_not_confirmed' | 'not_authenticated' | 'not_a_merchant'
    | 'unknown_package' | 'package_inactive' | string | null | undefined;

export const subscribeErrorMessage = (reason: SubscribeFailure, isRTL: boolean): string => {
    const r = String(reason || '').trim();

    if (/payment_not_confirmed/i.test(r)) {
        return isRTL
            ? '💳 لم تصل دفعةٌ مؤكَّدة من بوّابة الدفع، فلم تُفعَّل الباقة.\n\nبوّابةُ الدفع لم تُربط بعد، ولذلك لا يمكن شراءُ باقةٍ بالبطاقة الآن. احفظ مفاتيح بوّابتك من «لوحة التاجر ← بوّابة الدفع» ثمّ أعِد المحاولة.'
            : '💳 No confirmed payment arrived from the gateway, so the plan was not activated.\n\nThe payment gateway is not connected yet, so a card purchase cannot complete. Save your gateway keys in the seller dashboard, then try again.';
    }
    if (/not_authenticated/i.test(r)) {
        return isRTL
            ? '🔑 انتهت جلستُك. سجّل الدخول ثمّ أعِد المحاولة.'
            : '🔑 Your session expired. Sign in and try again.';
    }
    if (/not_a_merchant/i.test(r)) {
        return isRTL
            ? '🏪 هذه الباقات للمتاجر. افتح «صفحتي» وأكمل بيانات متجرك أوّلاً.'
            : '🏪 These plans are for stores. Open your store page and complete its details first.';
    }
    if (/unknown_package/i.test(r)) {
        return isRTL
            ? '📦 هذه الباقة لم تعد موجودة. حدّث الصفحة واختر باقةً من القائمة.'
            : '📦 That plan no longer exists. Refresh the page and pick one from the list.';
    }
    if (/package_inactive/i.test(r)) {
        return isRTL
            ? '📦 هذه الباقة موقوفةٌ حالياً. اختر باقةً أخرى من القائمة.'
            : '📦 That plan is currently disabled. Pick another one.';
    }
    return isRTL
        ? `⚠️ تعذّر تفعيل الباقة الآن. حاول بعد قليل، وإن تكرّر فأرسل لنا شكوى من «حسابي ← شكواي».${r ? `\n\n(${r})` : ''}`
        : `⚠️ Could not activate the plan right now. Try again shortly.${r ? `\n\n(${r})` : ''}`;
};

export default subscribeErrorMessage;
