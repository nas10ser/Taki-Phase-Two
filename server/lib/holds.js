/**
 * lib/holds.js — مهلة الحجز للبوتين (v14.12)
 * ═══════════════════════════════════════════════════════════════════════════
 * الرقم مصدره واحد: `platform_settings.booking_holds` على القاعدة، يضبطه ناصر
 * من لوحة المدير («⏳ مهلة الحجز» في تبويب الأدوات). هذا الملف يقرؤه ويخزّنه
 * دقيقةً واحدة — فتغيير اللوحة يصل البوتين خلال دقيقة بلا إعادة نشر.
 *
 * 🪤 لماذا وُجد: v14.10 نقلت المهلة إلى صفّ إعدادات واحد لكن نصوص البوتين بقيت
 *    تقول «ساعتان» و«ست ساعات» حرفياً. فأول ضبط من اللوحة كان سيجعل البوت يَعِد
 *    بما لا تفرضه القاعدة — وهو بالضبط نوع الانحراف الصامت الذي بُني كل التصميم
 *    على منعه.
 *
 * القراءة مباشرة من الجدول لا عبر دالة: سياسة `platform_settings_select` تسمح
 * بمفتاح `booking_holds` للجميع (v14.10b)، فالمفتاح العام يكفيه.
 *
 * الوحدة مشتركة بين `bot.js` و`flows/whatsapp.js` — نفس العملية ونفس النسخة،
 * فالتخزين المؤقت واحدٌ للقناتين (كل تعديل على البوت يمسّ الملفين معاً).
 */

const { arCount, enCount } = require('../../shared/arPlural');

// الافتراضات تطابق `taki_booking_hold_hours` على القاعدة حرفياً، كي لا يَعِد
// البوت برقم لا تُطبّقه القاعدة لو تعذّرت القراءة لحظةً.
// v15.42 — و`selfClose` بالدقائق: كم بعد الحجز قبل أن يُسمح بالختم بلا كود.
const FALLBACK = { pickup: 2, delivery: 6, safety: 72, selfClose: 10 };
const TTL_MS = 60_000;

let _client = null;
let _cache = { ...FALLBACK };
let _at = 0;

/** يُنادى مرّة واحدة من bot.js بعد إنشاء عميل Supabase. */
function init(client) { _client = client; }

const saneMinutes = (x, d) => {
    const n = typeof x === 'number' ? x : parseFloat(String(x == null ? '' : x));
    return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : d;
};

const sane = (x, d) => {
    const n = typeof x === 'number' ? x : parseFloat(String(x == null ? '' : x));
    return Number.isFinite(n) && n >= 0.25 && n <= 8760 ? n : d;
};

/** أرقام المهلة الحالية — تُعيد آخر قيمة معروفة عند أي فشل عابر. */
async function get() {
    const now = Date.now();
    if (!_client || now - _at < TTL_MS) return _cache;
    _at = now;
    try {
        const { data } = await _client
            .from('platform_settings').select('value').eq('key', 'booking_holds').maybeSingle();
        const v = data && data.value ? data.value : {};
        _cache = {
            pickup:   sane(v.pickup_hours, FALLBACK.pickup),
            delivery: sane(v.delivery_hours, FALLBACK.delivery),
            safety:   sane(v.in_progress_hours, FALLBACK.safety),
            // 🪤 بمدى خاصّ: صفرٌ قيمةٌ صالحة تعني «بلا مهلة»، و`sane` ترفض ما
            //    دون ربع الساعة — فهي لا تصلح للدقائق.
            selfClose: saneMinutes(v.self_close_minutes, FALLBACK.selfClose),
        };
    } catch { /* أبقِ آخر قيمة معروفة */ }
    return _cache;
}

/**
 * v15.43 — مهلةُ **متجرٍ بعينه**: استثناؤه إن وُجد، وإلّا افتراضُ المنصّة.
 * ═══════════════════════════════════════════════════════════════════════════
 * صارت المهلةُ بيد التاجر (أمرُ ناصر)، فلم يَعُد رقمُ المنصّة صحيحاً لكلّ متجر.
 *
 * 🪤 والحسابُ على القاعدة لا هنا: `store_policies` تُعيد المهلةَ **الفعّالة**
 *    محسوبةً بـ`taki_booking_hold_hours(kind, store)` — وهي نفسُها الدالّةُ
 *    التي يستعملها مشغّلُ الحجز. فما يَعِد به البوتُ هو ما سيُطبَّق حرفاً بحرف.
 *    ولو حُسبت هنا لصارت نسخةً ثانية تنحرف — وهو العيبُ الذي بُني كلُّ هذا
 *    الملفّ على منعه (v14.12).
 * 🪤 وعند أيّ فشلٍ عابر تُعاد قيمةُ المنصّة لا صفرٌ ولا خطأ: وعدٌ تقريبيٌّ
 *    أهونُ من شاشةِ حجزٍ لا تُفتح.
 * 🪤 والتخزينُ دقيقةٌ واحدة لكلّ متجر — كحال قيم المنصّة بالضبط.
 */
const _storeCache = new Map();

async function forStore(storeId) {
    const base = await get();
    const id = String(storeId || '').trim();
    if (!id || !_client) return base;
    const now = Date.now();
    const hit = _storeCache.get(id);
    if (hit && now - hit.at < TTL_MS) return hit.v;
    try {
        const { data } = await _client.rpc('store_policies', { p_store_id: id });
        const d = data || {};
        const v = {
            ...base,
            pickup:   sane(d.hold_pickup_hours,   base.pickup),
            delivery: sane(d.hold_delivery_hours, base.delivery),
        };
        _storeCache.set(id, { v, at: now });
        return v;
    } catch { return base; }
}

/** «ساعتان» / «two hours» — صيغة الرفع. */
function label(n, lang) {
    if (lang === 'en') return n === 1 ? 'one hour' : n === 2 ? 'two hours' : `${n} hours`;
    return n === 1 ? 'ساعة واحدة' : n === 2 ? 'ساعتان' : n <= 10 ? `${n} ساعات` : `${n} ساعة`;
}

/** «خلال ساعتين» / «within two hours» — صيغة المجرور العربية. */
function labelGen(n, lang) {
    if (lang === 'en') return label(n, lang);
    return n === 1 ? 'ساعة واحدة' : n === 2 ? 'ساعتين' : n <= 10 ? `${n} ساعات` : `${n} ساعة`;
}

/**
 * v15.42 — المتبقّي من مهلة «الختم بلا كود» مصوغاً، أو `null` إن انتهت.
 * 🪤 ولا تُصاغ الدقائق بـ`${n} دقائق`: العربية تحتاج خمس صيغ للمعدود،
 *    والمحرّك `shared/arPlural.js` وحده (ويقارنه `check-ar-plural.js`).
 * 🪤 ويُجبَر على دقيقة واحدة ما بقيت ثانية: «بعد ٠ دقائق» ثم رفضٌ = كذب.
 */
async function selfCloseLeft(bookedAt, lang, nowMs) {
    const h = await get();
    if (!(h.selfClose > 0)) return null;
    const left = Math.round((Number(bookedAt || 0) + h.selfClose * 60000 - (nowMs || Date.now())) / 1000);
    if (!(left > 0)) return null;
    return { seconds: left, label: waitLabel(left, lang) };
}

/**
 * ثوانٍ متبقّية ⇒ نصٌّ مصوغ. يستعملها مَن يعرف الثواني من القاعدة
 * (`too_soon` تُرجع `wait_seconds`) ومَن يحسبها من `booked_at` معاً.
 * 🪤 ودقيقةٌ واحدة أرضيّةٌ ما بقيت ثانية: «بعد ٠ دقائق» ثم رفضٌ = كذب.
 */
function waitLabel(seconds, lang) {
    const mins = Math.max(1, Math.ceil(Number(seconds || 0) / 60));
    return lang === 'en'
        ? enCount(mins, 'minute', 'minutes')
        : arCount(mins, 'minutes', true);   // المجرور: «بعد دقيقتين» لا «دقيقتان»
}

/**
 * مفردات رفض «استلمتُ طلبي» — موضعٌ واحد للقناتين.
 * 🪤 كان السلّم مكتوباً في `bot.js` و`flows/whatsapp.js` معاً، وهو بالضبط
 *    نوعُ الازدواج الذي أسكت البوتين عن أخطاء المحادثة من v12.22 إلى v14.96:
 *    رمزٌ يُضاف في القاعدة ويُنسى في إحدى النسختين.
 */
function receiptErrKey(error) {
    return ({
        too_soon: 'b_confirm_receipt_too_soon',
        not_dispatched: 'b_confirm_receipt_not_sent',
        not_delivery: 'b_confirm_receipt_pickup',
        closed: 'b_confirm_receipt_closed',
    })[String(error || '')] || 'b_confirm_receipt_failed';
}

module.exports = { init, get, forStore, label, labelGen, selfCloseLeft, waitLabel, receiptErrKey, FALLBACK };
