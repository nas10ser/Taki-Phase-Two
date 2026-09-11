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

// الافتراضات تطابق `taki_booking_hold_hours` على القاعدة حرفياً، كي لا يَعِد
// البوت برقم لا تُطبّقه القاعدة لو تعذّرت القراءة لحظةً.
const FALLBACK = { pickup: 2, delivery: 6, safety: 72 };
const TTL_MS = 60_000;

let _client = null;
let _cache = { ...FALLBACK };
let _at = 0;

/** يُنادى مرّة واحدة من bot.js بعد إنشاء عميل Supabase. */
function init(client) { _client = client; }

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
        };
    } catch { /* أبقِ آخر قيمة معروفة */ }
    return _cache;
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

module.exports = { init, get, label, labelGen, FALLBACK };
