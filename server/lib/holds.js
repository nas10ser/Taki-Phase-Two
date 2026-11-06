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

const { arCount, enCount, FORMS } = require('../../shared/arPlural');

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

// 🪤 v15.50 — حدودُ **سلامةٍ** لا أرضيّة: القيمةُ القادمة من `store_policies`
//    مقصوصةٌ على القاعدة بـ`taki_booking_hold_min()` أصلاً. ورفعُ هذا الحدّ
//    إلى الأرضيّة كان يُنتج ارتداداً إلى افتراض المنصّة (٢) حيث تُنفّذ القاعدةُ
//    الأرضيّةَ (١) — رقمان مختلفان لنفس المتجر بين البوت والقاعدة.
const sane = (x, d) => {
    const n = typeof x === 'number' ? x : parseFloat(String(x == null ? '' : x));
    return Number.isFinite(n) && n > 0 && n <= 8760 ? n : d;
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

// 🔴 v15.50 — كانت هاتان نسخةً **رابعةً** للمحرّك، تجاور المحرّكَ المستورد في
//    هذا الملفّ نفسه. وشرطُها `n <= 10` يشمل الكسورَ فيُنتج «1.5 ساعات» —
//    والمهلةُ تقبل ١٫٥. و`check-ar-plural.js` لا يراها فنجت. والآن تنادي
//    `arCount` كبقيّة البيئات الثلاث، فلا صيغةَ خامسة تنحرف.
/** «ساعتان» / «two hours» — صيغة الرفع. */
function label(n, lang) {
    return lang === 'en' ? enCount(n, 'hour', 'hours') : arCount(n, FORMS.hours);
}

/** «خلال ساعتين» / «within two hours» — صيغة المجرور العربية. */
function labelGen(n, lang) {
    return lang === 'en' ? enCount(n, 'hour', 'hours') : arCount(n, FORMS.hours, true);
}

/**
 * v15.44 — حالةُ «الختم بلا كود» لطلبٍ، بمرساةٍ مزدوجة.
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: الساعةُ من **تأكيد التاجر**. ومعها فتحةٌ احتياطيّة في آخر المهلة
 * لأن «لا تأكيدَ ⇒ لا زرَّ أبداً» تُسقط المشتري (قِيس: ١٤٪ من الطلبات المكتملة
 * لم تُؤكَّد قطّ). وتُعيد `null` حين يُفتح الزرّ، وإلّا `{seconds, acknowledged}`.
 *
 * 🔴 والمرساةُ تُقرأ من `ack_at_ms`/`booked_at_ms`/`expiry_time` لا من
 *    `booked_at`: الأخيرةُ **نصُّ وقتٍ** في ردّ `bot_get_my_bookings`
 *    (`to_timestamp`) و`Number()` عليها NaN — وهذا ما جعل بوّابةَ v15.42
 *    ميّتةً في القناتين. مفتاحٌ موجودٌ بالاسم ليس مفتاحاً صالحاً بالقيمة.
 */
function isAcknowledged(b) {
    return !!(b && (Number.isFinite(Number(b.ack_at_ms)) && Number(b.ack_at_ms) > 0
                    || b.status === 'acknowledged'));
}

// 🔴 والسقفُ (`expiry − دقيقة`) لازم: بدونه مهلةٌ قصيرة مع تأكيدٍ متأخّر
//    تُنتج نافذةً خالية — الزرُّ يُفتح بعد أن يُلغى الطلب.
function selfCloseOpensAt(b, minutes) {
    const ms = minutes * 60000;
    const bk = Number(b && b.booked_at_ms);
    const booked = Number.isFinite(bk) ? bk : 0;
    const ex = Number(b && b.expiry_time);
    const expiry = Number.isFinite(ex) ? ex : 0;
    const ack = Number(b && b.ack_at_ms);
    // 🔴 v15.47 — الأسبقُ من المرساتين: التأكيدُ يُعجّل الفتحَ ولا يؤجّله.
    if (!(minutes > 0)) return booked;
    const ackAt = (Number.isFinite(ack) && ack > 0)
        ? Math.max(booked + ms, ack + ms)
        : (b && b.status === 'acknowledged') ? booked + ms : Number.POSITIVE_INFINITY;
    const fallback = Math.max(booked + ms, (expiry > 0 ? expiry : Number.POSITIVE_INFINITY) - ms);
    const raw = Math.min(ackAt, fallback);
    return expiry > 0 ? Math.min(raw, expiry - 60000) : raw;
}

async function selfCloseState(booking, lang, nowMs) {
    const h = await get();
    if (!(h.selfClose > 0)) return null;
    const left = Math.round((selfCloseOpensAt(booking, h.selfClose) - (nowMs || Date.now())) / 1000);
    if (!(left > 0)) return null;
    return { kind: 'waiting', seconds: left, acknowledged: isAcknowledged(booking), label: waitLabel(left, lang) };
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
        not_acknowledged: 'b_confirm_receipt_not_acked',
        not_dispatched: 'b_confirm_receipt_not_sent',
        not_delivery: 'b_confirm_receipt_pickup',
        closed: 'b_confirm_receipt_closed',
    })[String(error || '')] || 'b_confirm_receipt_failed';
}

module.exports = { init, get, forStore, label, labelGen, isAcknowledged, selfCloseOpensAt, selfCloseState, waitLabel, receiptErrKey, FALLBACK };
