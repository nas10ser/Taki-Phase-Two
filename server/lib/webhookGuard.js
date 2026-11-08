/**
 * webhookGuard.js — حدُّ المعدّل والتوثيقُ على حدّ HTTP (v15.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **حدُّ معدّلٍ على عنوانٍ لا تراه ليس حدّاً — هو مفتاحُ إطفاء.**
 *    كان في `bot.js`:  `const ip = req.ip || req.headers['x-forwarded-for']`
 *    و`app.set('trust proxy', …)` **لم يُضبط قطّ** — فـ`req.ip` على Render
 *    هو عنوانُ موجّهِ Render نفسه، **واحدٌ لكلّ زوّار الأرض**. أي أن
 *    `globalRL` كانت دلواً واحداً للإنترنت كلّه: ≈٣٠٠ طلبٍ مجهولٍ تُسقط
 *    البوتَ خمسَ دقائق لكلّ المستخدمين، ثم طلبٌ في الثانية يُبقيه ساقطاً.
 *    والارتدادُ `|| x-forwarded-for` كودٌ ميت: `req.ip` صادقٌ دائماً.
 *    🪤 ونافذتُها تُقاس من **أوّل** طلبٍ لا من آخره، فلا تُفرَّج أبداً.
 *
 * 🔴 **وكان العدُّ قبل التوثيق.** الحدُّ `app.use` في السطر ١٢٨، وفحصُ سرّ
 *    تيليجرام في السطر ٣٨٦١ — فكلُّ محاولةٍ مرفوضةٍ بـ٤٠٣ تستهلك حصّةَ
 *    تيليجرام الحقيقيّ. ⇒ **يُوثَّق أوّلاً، ثم يُعدّ، وعلى هويّةٍ نراها.**
 *
 * 🪤 وكلُّ خريطةٍ هنا **مسقوفة**: دلوٌ بلا سقفٍ هو عيبُ استنفادِ الذاكرة
 *    القادم، والمفتاحُ بيد المهاجم فعلاً — `chat.id` يُنشئه بحسابِ تيليجرام
 *    جديد، فمليونُ حسابٍ مليونُ صفٍّ على ٥١٢ م.ب.
 *    والطردُ بالأقدمِ إدخالاً (ترتيبُ `Map` إدخاليّ) لا بالرفض: رفضُ مفتاحٍ
 *    جديدٍ لأن الخريطة ملأى يُعيد «مفتاحَ الإطفاء» من بابٍ آخر.
 */

const crypto = require('crypto');

const MAX_KEYS = 50_000;        // سقفُ دلاء المعدّل
const SEEN_MAX = 20_000;        // سقفُ نافذة التكرار
const SEEN_MS = 600_000;        // ١٠ دقائق — أوسعُ من أفق إعادةِ محاولةِ ميتا

/** يطرد الأقدمَ إدخالاً حتى يعود الحجمُ تحت السقف. */
function evict(map, cap) {
    if (map.size <= cap) return;
    for (const k of map.keys()) { map.delete(k); if (map.size <= cap * 0.9) break; }
}

// ── دلاءُ المعدّل: مفتاحٌ واحدٌ لكلّ هويّةٍ نراها فعلاً ──────────────────────
const buckets = new Map();
/** `true` = مسموح. النافذةُ متجدّدة، والمفتاحُ هويّةٌ لا عنوان. */
function allow(key, limit = 30, windowMs = 60_000) {
    const now = Date.now();
    const e = buckets.get(key);
    if (!e || now - e.t > windowMs) {
        buckets.set(key, { t: now, n: 1 });
        evict(buckets, MAX_KEYS);
        return true;
    }
    return ++e.n <= limit;
}

// ── نافذةُ التكرار: مُشتركةٌ بين القناتين، بمعرّف كلِّ قناةٍ هو ─────────────
// 🪤 توقيعُ ميتا يغطّي الجسمَ وحده — بلا طابعٍ زمنيّ — فجسمٌ وُقّع مرّةً يبقى
//    قابلاً للإعادة أبداً. والمُطلِقُ الواقعيّ ليس مهاجماً بل إعادةُ ميتا
//    نفسِها: الردّ ٢٠٠ يُرسل **قبل** المعالجة، فضياعُه يُعيد تنفيذَ الأمر.
const seen = new Map();
let seenSweptAt = 0;
/** `true` = أوّلُ مرّة (نفّذ)، `false` = مكرّرٌ داخل النافذة (أهمِل). */
function fresh(id) {
    const now = Date.now();
    if (now - seenSweptAt > 60_000) {
        seenSweptAt = now;
        for (const [k, t] of seen) if (now - t > SEEN_MS) seen.delete(k);
    }
    const at = seen.get(String(id));
    if (at !== undefined && now - at <= SEEN_MS) return false;
    seen.set(String(id), now);
    evict(seen, SEEN_MAX);
    return true;
}

// ── مقارنةُ سرٍّ بزمنٍ ثابت، وآمنةٌ للطول ────────────────────────────────────
/**
 * 🪤 `timingSafeEqual` **يرمي** عند اختلاف الطول — فاستثناؤه نفسُه قناةُ
 *    تسريبٍ للطول. ولذلك تُقارَن بصمتا SHA-256 (طولٌ ثابتٌ دائماً) ثم
 *    يُشترط تطابقُ الطول — وهو النمطُ القياسيّ لا اجتهاد.
 * 🪤 وسرٌّ فارغ يُرجع `false` دائماً: «غيرُ مضبوط» ليس «يطابق».
 */
function secretEqual(got, want) {
    const a = Buffer.from(String(got == null ? '' : got), 'utf8');
    const b = Buffer.from(String(want == null ? '' : want), 'utf8');
    if (b.length === 0) return false;
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * الوسيطُ على مسارَي الخطّاف، ويُركَّب **قبل** أيّ محلِّلِ جسم.
 * فحصُ سرّ تيليجرام لا يحتاج جسماً إطلاقاً ⇒ الطلبُ المجهول يُردّ قبل أن
 * يلمسَه `body-parser` (وذاك سطحُ `GHSA-27r3-jxmh-p828` **قبل التوثيق**:
 * كان المحلِّلان مركَّبين app-wide في السطرين ١٢٥–١٢٦ والسرُّ يُفحص في ٣٨٦١).
 * ولواتساب يُتحقَّق هنا من **شكل** الترويسة وحده — وHMAC الحقيقيّ يبقى في
 * موضعه فوق البايتات الخام، فلا يُبنى توقيعٌ على إعادةِ ترميز.
 *
 * 🔴 **ولا عدَّ لكلّ عنوانٍ هنا إطلاقاً — وهذا قرارٌ قِيس لا رأي.** كتبتُ
 *    أوّلاً عدّاداً للطلبات المرفوضة لكلّ `req.ip` (مع `trust proxy`)، ثم
 *    قِستُه على express حقيقيّ: ٤٠٠ طلبٍ مجهول ثمّ **طلبٌ موقَّعٌ صحيحاً**
 *    ⇒ `status=429 {"error":"rate limit"}`. أي أنني أعدتُ بناءِ **مفتاح
 *    الإطفاء** نفسِه الذي جئتُ لأُسقطه، بمفتاحٍ أدقّ وحده.
 *    وأيُّ عدٍّ على عنوانٍ يُشارك الصادقُ فيه المهاجمَ قابلٌ لذلك دائماً —
 *    ولو أخطأ `trust proxy` مرّةً، أو بدّلت Render طريقةَ تمريرها، لعاد
 *    الدلوُ المشترك كما كان. ⇒ **الرفضُ قبل التحليل هو الحماية**، ولا شيءَ
 *    أرخصُ منه يُضاف فوقه: فحصُ ترويسةٍ واحدة بلا قاعدةٍ ولا وحدةِ معالجة.
 *    والعدُّ الحقيقيّ موضعُه بعد التوثيق، على هويّةٍ نراها (`allow`).
 * 🪤 ولذلك **لا يُضبط `trust proxy`**: لم يبقَ قارئٌ لـ`req.ip`، وضبطُه
 *    يُحيي `GHSA-jqcg-44mw-7w3h` في `proxy-addr` بلا مقابل. (كان في مسوّدتي
 *    سطرٌ يضبطه — أُسقط بعد القياس.)
 *
 * 🪤 ويُركَّب **لكلّ مسارٍ على حدة** لا بمصفوفةِ مسارات: داخل `app.use(path,…)`
 *    يصير `req.path` نسبياً إلى موضع التركيب («/»)، فأيُّ تفريعٍ عليه داخل
 *    الوسيط يكذب. فالمسارُ يُقرَّر عند التركيب، لا عند الطلب.
 */
function webhookEdge(opts = {}) {
    const tg = opts.tgSecret;                      // `undefined` ⇒ مسارُ واتساب
    return (req, res, next) => {
        if (tg !== undefined) {
            if (!tg) return res.status(503).json({ error: 'not configured' });
            if (!secretEqual(req.headers['x-telegram-bot-api-secret-token'], tg)) return res.status(403).json({ error: 'Forbidden' });
            return next();
        }
        if (req.method === 'POST' && !/^sha256=[0-9a-f]{64}$/.test(String(req.headers['x-hub-signature-256'] || ''))) {
            return res.status(403).json({ error: 'Invalid signature' });
        }
        return next();
    };
}

module.exports = {
    allow, fresh, secretEqual, webhookEdge,
    _internals: { buckets, seen, MAX_KEYS, SEEN_MAX, SEEN_MS },
};
