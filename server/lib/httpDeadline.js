/**
 * httpDeadline.js — مهلةٌ تُغطّي التبادلَ كلَّه: الترويساتَ **والجسم** (v15.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **العيبُ الذي كان، وهو العيبُ الذي كُتب الحارسُ لمنعه.** كان في موضعين
 *    متطابقين (`bot.js` و`flows/whatsapp.js`):
 *        return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
 *    و`.finally` تتعلّق بوعدِ **الجلب**، وهو يُحسم لحظةَ وصول الترويسات —
 *    فتُمسح المهلةُ قبل أن يُقرأ بايتٌ واحدٌ من الجسم. أي أن قراءةَ
 *    `supabase-js` لردّ PostgREST و`r.json()` و`r.text()` كلُّها تجري
 *    **بلا مهلةٍ إطلاقاً**: مضيفٌ يُرسل `200`+ترويسات ثم يتوقّف في منتصف
 *    الجسم يُعلّق الانتظارَ أبداً.
 *    وتعليقُ `bot.js:105` يقول النتيجةَ بنفسه: «كان يجمّد rpc() للأبد، وأعلام
 *    busy في حلقات outbox/email تبقى مرفوعة فتتوقف الإشعارات بصمت حتى إعادة
 *    التشغيل». فالحارسُ كان يُسمّي عيبَه ولا يمنعه. وقِيس نفسُ النمط حرفياً
 *    في `lib/geo.js`: ٣٤ ⇐ ٦٨٥ م.ب بلا عودةٍ في ٢٥ ثانية رغم مهلةِ ٨ ثوانٍ.
 *
 * ولماذا هذا الشكلُ بالضبط — **الجسمُ يُقرأ هنا، داخل المهلة، ثمّ يُعاد ردٌّ
 *    جاهز**: هذا الملفّ يُركَّب كـ`global.fetch` لعميل سوبابيس، فالجسمَ يقرؤه
 *    العميلُ لا نحن، ولا سبيلَ لمدّ مهلتنا إلى قراءةٍ تجري خارجنا. البدائلُ
 *    أسوأ قياساً: تركُ المؤقّت مسلَّحاً بلا مسحٍ يُفجّر البثّ بعد ١٥ ثانيةً
 *    حتى حين لا يقرأ المنادي الجسمَ أصلاً (`if (!r.ok) return null`) فيصير
 *    ضجيجَ `unhandledRejection`؛ وتمريرُ دالّةِ إنهاءٍ على الردّ يُلزم كلَّ
 *    منادٍ أن يتذكّرها — وما يعتمد على التذكّر ينكسر عند أوّل منادٍ جديد.
 *    والأجسامُ هنا كلُّها صغيرة (ردودُ PostgREST وGraph)، والسقفُ يحسم الباقي.
 *
 * 🪤 وسقفُ البايتات ليس تجميلاً: ردٌّ بلا نهايةٍ من أيّ مضيفٍ خارجيّ هو نفسُ
 *    قاتلِ الـ٥١٢ م.ب على Render. فلا `r.text()` ولا `r.json()` على بثٍّ
 *    غير محدودٍ في هذا المشروع — هذا الملفّ هو الموضعُ الوحيد لقراءة جسم.
 */

const DEFAULT_MS = 15_000;
const DEFAULT_MAX = 8 * 1024 * 1024;
/** حالاتٌ يمنع المعيارُ أن يكون لها جسم — فبناءُ `Response` بجسمٍ لها يرمي. */
const NO_BODY = new Set([204, 205, 304]);

/**
 * يقرأ جسمَ الردّ ببايتاتٍ محدودة ثم يقطع البثّ. يُرجع `Buffer`.
 * 🪤 ويقطع عند السقف بـ`cancel()` لا بالتوقّف وحده: التوقّفُ بلا إلغاءٍ
 *    يترك المقبسَ يُغذّي مخزنَ البثّ الداخليّ فيعود الانتفاخُ من الخلف.
 */
async function readCappedBuffer(r, maxBytes = DEFAULT_MAX) {
    if (!r || !r.body || typeof r.body.getReader !== 'function') return Buffer.alloc(0);
    const reader = r.body.getReader();
    const parts = []; let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            parts.push(total > maxBytes ? value.subarray(0, value.length - (total - maxBytes)) : value);
            if (total >= maxBytes) break;
        }
    } finally { try { await reader.cancel(); } catch { /* أُغلق أصلاً */ } }
    return Buffer.concat(parts);
}

/** نفسُها نصّاً — يستعملها `lib/geo.js` فلا تبقى نسختان تنحرفان. */
const readCapped = async (r, maxBytes) => (await readCappedBuffer(r, maxBytes)).toString('utf8');

/**
 * `fetch` بمهلةٍ تغطّي الترويساتَ والجسم. يُعيد `Response` حقيقياً جاهزاً،
 * فـ`.ok`/`.status`/`.json()`/`.text()` تعمل كما يتوقّعها كلُّ منادٍ.
 * 🪤 وتُحذف `content-encoding`/`content-length` من الردّ المُعاد: البايتاتُ
 *    صارت مفكوكةَ الضغط ومعروفةَ الطول، وترويسةٌ تكذب أسوأُ من غيابها.
 */
async function fetchWithDeadline(url, opts = {}, ms = DEFAULT_MS, maxBytes = DEFAULT_MAX) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
        const r = await fetch(url, { ...opts, signal: c.signal });
        const h = new Headers(r.headers);
        h.delete('content-encoding'); h.delete('content-length');
        const init = { status: r.status, statusText: r.statusText, headers: h };
        if (NO_BODY.has(r.status) || !r.body) {
            try { await r.body?.cancel(); } catch { /* بلا جسم */ }
            return new Response(null, init);
        }
        return new Response(await readCappedBuffer(r, maxBytes), init);
    } finally { clearTimeout(t); }
}

module.exports = { fetchWithDeadline, readCapped, readCappedBuffer, DEFAULT_MS, DEFAULT_MAX };
