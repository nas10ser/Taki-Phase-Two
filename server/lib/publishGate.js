/**
 * lib/publishGate.js — بوّابةُ النشر: سببٌ مفهوم بدل «تعذّر النشر» (v14.94)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجدت، وقد قِيس: `rpc()` في `server/bot.js` تكتب الخطأ في سجلّ Render
 *    و**تُرجع `null`** — لا الرمز ولا الرسالة. فأيّ استثناءٍ يرفعه مشغّلُ
 *    `deals` («المتجر غير موثَّق») يصل التاجرَ جملةً واحدة عمياء: «تعذّر النشر،
 *    حاول مجدداً». يُعيد المحاولة فيفشل، ولا شيء في أي شاشةٍ يقول له أن يوثّق.
 *
 * وأسوأ من ذلك حالةُ الإقرار: `tr_ac_publish_needs_declaration` لا يرفع شيئاً
 * أصلاً — يحوّل العرض إلى **مسوّدة** ويُرجع `success:true`. أي أن البوت كان
 * يقول «🎉 تم النشر بنجاح» عن عرضٍ لم يُنشر قطّ.
 *
 * فالعلاج أن نسأل قبل أن نرسل: `bot_publish_gate` تُرجع السبب صراحةً، والبوتان
 * يفرّعان عليه. وهي **لا تحلّ محلّ الحارس** — الحارس مشغّلات القاعدة نفسها،
 * وهي تعمل على مسارات النشر الخمسة كلّها وعلى الكتابة المباشرة على الجدول.
 *
 * 🪤 مفرداتُ الأسباب **منسوخةٌ من نصّ الدوال لا من الذاكرة** (نفس درس
 *    `chatView.js`، حيث فحص البوتان لسنتين رموزاً لا تُرجعها القاعدة أبداً):
 *      `taki_publish_block()` ⇐ 'not_merchant' · 'not_verified' · NULL
 *      `store_can_sell()`     ⇐ 'not_declared' · 'no_method'
 *    وأيّ رمزٍ جديد يُضاف في القاعدة يُضاف هنا — ولا يُكتب في البوتين.
 */

const { arCount, enCount } = require('../../shared/arPlural');

/** رمزُ المنع ⇐ مفتاحُ ترجمة. */
const KEYS = {
    not_merchant: 'pub_not_merchant',
    not_verified: 'pub_not_verified',
    not_declared: 'pub_not_declared',
    no_method:    'pub_no_method',
};

/**
 * مفتاحُ الرسالة لسببٍ ما، كي يكتب المنادي `tr(messageKey(r.reason))`.
 * 🪤 والافتراضيّ نصُّ التوثيق: رمزٌ لم نعرفه يعني أن القاعدة كسبت سبباً جديداً،
 *    وشاشةُ التوثيق هي الوحيدة التي تشرح للتاجر حالَ متجره كاملاً — فهي أقلّ
 *    الوجهات ضرراً حتى يُضاف المفتاح هنا.
 */
const messageKey = (reason) => KEYS[reason] || KEYS.not_verified;

/**
 * «خلال ٢٤ ساعة» / «within 24 hours» — العدد مصوغاً من `shared/arPlural.js`
 * وحدها (القاعدة القديمة: لا يُكتب رقمُ ساعاتٍ نصّاً، ولا يُصاغ يدوياً).
 * والارتداد ٢٤ ليس اختراعاً: هو حرفياً افتراضُ `taki_verification_policy()`
 * (`COALESCE(…, 24)` وحدّها `GREATEST(1, LEAST(720, …))`) — فلا نَعِد بأسرع
 * ممّا يَعِد به الخادم، ولا يظهر «0 ساعة» في أي حال.
 */
function hoursLabel(n, lang) {
    const h = Number(n);
    const v = Number.isFinite(h) && h >= 1 ? Math.round(h) : 24;
    return lang === 'en' ? enCount(v, 'hour', 'hours') : arCount(v, 'hours', true);
}

/**
 * الفحص. `ids = { p_telegram_id, p_whatsapp_id }` — نفس هويّة بقيّة نداءات البوت.
 * تُرجع `{ ok, reason, slaHours }`.
 *
 * 🔴 **فشلُ النداء = سماح (fail-open)، عمداً.** ولماذا هو الصواب *هنا بالذات*:
 *    هذه الدالّة لا تحرس شيئاً — كلّ عملها أن تترجم منعاً واقعاً إلى جملةٍ
 *    مفهومة. الحارس الحقيقي مشغّلا `deals` على الخادم، وهما يرفضان عرضَ غير
 *    الموثَّق سواءٌ سألناهما قبلُ أم لا. فلو أغلقنا عند الفشل لأضفنا **عطلاً
 *    جديداً بلا أي أمنٍ جديد**: انقطاعُ شبكةٍ لحظي، أو تغييرُ منحٍ، أو إقلاعُ
 *    قاعدة — كلّها تمنع تاجراً موثَّقاً تماماً من النشر لسببٍ لا يخصّه ولا
 *    يستطيع إصلاحه. وأما السماحُ عند الفشل فأسوأ ما يكلّف أن يعود التاجر إلى
 *    الرسالة العامّة القديمة — وهي الحالُ قبل هذا الملفّ كلّه.
 *
 * 🪤 و«لا هويّة» (`success:false` · `error:'not_seller'`) فشلٌ كذلك لا منع:
 *    الحسابُ غير مربوط، وشاشاتُ التاجر ترفضه قبل هذه النقطة أصلاً.
 */
async function check(rpc, ids) {
    let r = null;
    try {
        r = await rpc('bot_publish_gate', { p_telegram_id: null, p_whatsapp_id: null, ...(ids || {}) });
    } catch (e) {
        console.warn('publishGate check:', e.message);
        r = null;
    }
    if (!r || typeof r !== 'object' || r.success !== true || r.ok !== false) {
        return { ok: true, reason: null, slaHours: 0 };
    }
    return { ok: false, reason: r.reason || null, slaHours: Number(r.sla_hours) || 0 };
}

/**
 * الحارس جاهزاً للاستعمال: يفحص، ويُبلّغ عند المنع، ويُرجع `true` إن مُنع —
 * فيكتب المنادي `if (await blocked(…)) return;` سطراً واحداً.
 *
 * 🪤 وسطرٌ واحد ليس ترفاً: `server/bot.js` و`server/flows/whatsapp.js` محكومان
 *    بسقّافة `check-file-size.js` فلا يجوز أن ينموا سطراً واحداً. فكلّ ما
 *    يمكن نقلُه إلى هنا يُنقَل، ويبقى في القناة إرسالُها وحده.
 *
 * `notify(body, btnLabel)` تُمرَّر من القناة لأن الإرسال وحده يختلف: تيليجرام
 * زرُّ `webApp` وMarkdownV2، وواتساب نصٌّ عاديّ ورابطٌ ملحق بالمتن.
 * وفشلُ الإبلاغ لا يفتح البوّابة: المنع قائمٌ سواء وصلت الرسالة أم لا.
 */
async function blocked(rpc, ids, { tr, lang, notify }) {
    const g = await check(rpc, ids);
    if (g.ok) return false;
    try { await notify(tr(messageKey(g.reason), hoursLabel(g.slaHours, lang)), tr('pub_open_dashboard')); }
    catch (e) { console.warn('publishGate notify:', e.message); }
    return true;
}

module.exports = { KEYS, messageKey, hoursLabel, check, blocked };
