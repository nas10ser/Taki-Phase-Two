/**
 * stockView.js — رقمُ المخزون في البوتين، بمعنىً واحد (v15.05)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجد هذا الملفّ — وهو درسٌ أغلى من الكود الذي فيه:
 *    v15.02 غيّرت **دلالة** `deals.quantity` من «مخزون التاجر» إلى «المتاح
 *    الآن» (= الكامل − المحجوز). ولوحقت الواجهة في v15.04، ولم يُلاحق
 *    البوتان. فبقي التاجر في تيليجرام وواتساب يقرأ المتاحَ مكتوباً «الكمية
 *    الحالية»، ويُعيد كتابته، **فينكمش مخزونه الكامل بمقدار المحجوز عند كلّ
 *    تعديل** — بلا خطأ، وبلا أن يلاحظ أحد.
 *    وقِيس على الإنتاج بعد شحن v15.03 بساعات، لا استُنتج.
 *
 * 🪤 والقاعدة المستخلصة: **تغييرُ دلالةِ عمودٍ ليس تغييراً في القاعدة — بل
 *    في كلّ سطحٍ يعرضه أو يطلبه.** الموقعُ والبوتان وأيُّ ربطٍ قادم.
 *
 * 🪤 ولماذا ملفٌّ مشترك لا سطرٌ في كل بوت: `server/bot.js` (٤١٦١) و
 *    `server/flows/whatsapp.js` (٢٦٩٥) عند سقفهما تماماً في السقّافة ولا
 *    يقبلان سطراً واحداً. وهذا هو نفسُ سبب وجود `chatView.js` — ونتيجتُه
 *    هناك كانت اكتشافَ أن البوتين انحرفا بصمت منذ v12.22.
 */

const { tr } = require('./i18n');

/**
 * المخزون الكامل عند التاجر. `null` = عرضٌ بلا حدّ.
 * 🪤 والارتدادُ إلى `quantity` مقصود: بوتٌ قديم على Render لم تصله الهجرة بعد
 *    يستقبل حمولةً بلا `on_hand`، فالأفضل رقمٌ قديم من «—».
 */
function fullOf(d) {
    if (!d || d.is_unlimited) return null;
    const oh = d.on_hand;
    if (oh === null || oh === undefined) return (d.quantity === null || d.quantity === undefined) ? null : Number(d.quantity);
    return Number(oh);
}

/** المتاح للبيع الآن (ما يراه المشتري). */
function availableOf(d) {
    if (!d || d.is_unlimited) return null;
    return (d.quantity === null || d.quantity === undefined) ? null : Number(d.quantity);
}

/** المحجوز الآن = الكامل − المتاح. لا ينزل تحت الصفر. */
function heldOf(d) {
    const f = fullOf(d), a = availableOf(d);
    if (f === null || a === null) return 0;
    return Math.max(0, f - a);
}

/**
 * السطرُ الذي يراه **التاجر**: كاملُه أوّلاً، ثمّ المحجوز والمتاح إن وُجد حجز.
 * 🪤 ولا يُعرض المحجوزُ حين يكون صفراً: سطرٌ يقول «محجوز: ٠» يُقلق بلا سبب.
 */
function sellerQty(d) {
    if (!d || d.is_unlimited) return tr('stk_unlimited');
    const f = fullOf(d);
    if (f === null) return '—';
    const h = heldOf(d);
    return h > 0 ? tr('stk_full_held', f, h, Math.max(0, f - h)) : tr('stk_full', f);
}

/** ونسخةٌ بلا تنسيق للأسطر الضيّقة (صفّ قائمة واتساب: ٢٤ حرفاً للعنوان). */
function sellerQtyShort(d) {
    if (!d || d.is_unlimited) return tr('stk_unlimited');
    const f = fullOf(d);
    if (f === null) return '—';
    const h = heldOf(d);
    return h > 0 ? tr('stk_short_held', f, h) : tr('stk_short', f);
}

/**
 * هل نفد فعلاً؟
 * 🪤 الشرطُ منسوخٌ حرفياً من قاعدة البيانات — `v_capped := NOT is_unlimited
 *    AND COALESCE(initial_quantity,0) > 0` في `tr_reserve_booking_stock` و
 *    `adjust_deal_quantity`. أي محاولةٍ لتحسينه هنا تصنع مصدراً ثانياً ينحرف.
 * 🪤 وأوّل نسخةٍ كتبتُها استعملت `fullOf(d) !== null` بدل السقف، فوسمت
 *    **عرضاً زمنيّاً بلا سقف** بأنه «نفد» لأن متاحه صفر — وهو عرضٌ ينتهي
 *    بالوقت لا بالكمّية. أمسكه اختبارٌ من خمسة أسطر.
 */
function isSoldOut(d) {
    if (!d || d.is_unlimited) return false;
    if (!(Number(d.initial_quantity || 0) > 0)) return false;   // بلا سقفٍ = لا ينفد
    return Number(availableOf(d) || 0) <= 0;
}

module.exports = { fullOf, availableOf, heldOf, sellerQty, sellerQtyShort, isSoldOut };
