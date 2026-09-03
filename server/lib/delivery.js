'use strict';
/**
 * delivery.js — قرار «هل نعرض التوصيل؟» في البوتين (v14.06)
 *
 * ── لماذا ملف مستقل؟ ──────────────────────────────────────────────────────
 * البوتان توأمان بقاعدة ثابتة في هذا المستودع: **كل تعديل على بوت يُطبَّق على
 * الآخر**. وقرار التوصيل خمسة فروع (لا يوصّل · لا عنوان · خارج النطاق · تحت
 * الحدّ الأدنى · متاح)، وتكرارها في ملفَين يعني انحرافاً محتوماً عند أول تعديل.
 * فالقرار هنا، والبوتان يرسمان الرسالة فقط — كلٌّ بغلافه (أزرار تيليجرام
 * المضمّنة مقابل أزرار واتساب الثلاثة).
 *
 * ── ولماذا لا نثق بالواجهة أصلاً؟ ─────────────────────────────────────────
 * لا نثق: حارس القاعدة (`tr_ac_booking_delivery`) هو الفاصل — يرفض التوصيل
 * خارج النطاق، ويثبّت الرسوم بنفسه، ويفرض طريقة الدفع التي حدّدها التاجر.
 * هذه الدالة تُطابق قراره لتُظهر للمستخدم ما سيُقبل فعلاً، لا لتحلّ محلّه.
 */

/**
 * @param {object|null} q ناتج `bot_delivery_quote` (ok · enabled · available ·
 *   has_address · reason · fee · min_order · payment · eta_min · zone_name · label)
 * @param {number} goods قيمة البضاعة (سعر العرض × الكمية) بلا رسوم التوصيل
 * @returns {{
 *   ask: boolean, canDeliver: boolean,
 *   reason: null|'off'|'no_address'|'out_of_zone'|'min_order',
 *   fee: number, minOrder: number, payment: 'cod'|'card'|'both',
 *   eta: number|null, zoneName: string, label: string|null
 * }}
 *   `ask=false` ⇒ لا تسأل المستخدم إطلاقاً (متجرٌ لا يوصّل، أو تعذّر السؤال):
 *   يمرّ مسار الحجز كما كان قبل v14.06 حرفياً — سؤالٌ بلا معنى أسوأ من لا سؤال.
 */
function deliveryOffer(q, goods) {
    const off = {
        ask: false, canDeliver: false, reason: 'off',
        fee: 0, minOrder: 0, payment: 'cod', eta: null, zoneName: '', label: null,
    };
    if (!q || q.ok !== true || !q.enabled) return off;

    const fee = Number(q.fee) || 0;
    const minOrder = Number(q.min_order) || 0;
    const payment = (q.payment === 'card' || q.payment === 'both') ? q.payment : 'cod';
    const eta = q.eta_min == null ? null : Number(q.eta_min);
    const base = {
        ask: true, canDeliver: false, reason: null,
        fee, minOrder, payment, eta,
        zoneName: q.zone_name == null ? '' : String(q.zone_name),
        label: q.label == null ? null : String(q.label),
    };

    // لا عنوان محفوظ: العنوان يُضاف من الموقع مرة واحدة (لا نجمع عناوين في محادثة).
    if (!q.has_address) return { ...base, reason: 'no_address' };
    // خارج نطاق التاجر: طلب ناصر الصريح — **لا يستطيع اختيار توصيل**.
    if (!q.available) return { ...base, reason: 'out_of_zone' };
    // تحت الحدّ الأدنى: يُقاس على البضاعة وحدها (كما يفعل حارس القاعدة بطرح الرسوم).
    // ⚠️ **الفشل مغلق**: قيمةٌ لا نعرفها (NaN/undefined) تُعامَل صفراً فلا تفتح
    // التوصيل. `NaN < 100` تعطي false، فلو اعتمدناها لسمحنا بطلبٍ لا نعرف قيمته
    // ثم رفضه الخادم — ووعدٌ يُخلَف أسوأ من خيارٍ لا يظهر. (كشفه اختبار الوحدة.)
    const goodsNum = Number(goods);
    const goodsSafe = Number.isFinite(goodsNum) ? goodsNum : 0;
    if (minOrder > 0 && goodsSafe < minOrder) return { ...base, reason: 'min_order' };

    return { ...base, canDeliver: true };
}

/**
 * طريقة الدفع التي يفرضها التاجر على التوصيل.
 * `card` ⇒ إلكتروني إلزاماً، `cod` ⇒ نقداً، `both` ⇒ يبقى اختيار المستخدم.
 * (القاعدة تفرض الأمر نفسه — هذا لعرضه للمستخدم قبل التأكيد لا للاعتماد عليه.)
 */
function forcedPayment(payment) {
    if (payment === 'card') return 'online';
    if (payment === 'cod') return 'cod';
    return null;
}

module.exports = { deliveryOffer, forcedPayment };
