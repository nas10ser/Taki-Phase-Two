/**
 * stockSync.js — نُخبر نظامَ التاجر بكلّ حركةٍ في مخزونه (v15.08)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلبُ ناصر: «وفي حالة الاسترداد ترجع الكميه كذلك سواء في موقع تاكي **أو من
 * نظام المخزون حق التاجر**». وهذا هو النصفُ الثاني: تاكي تُبلّغ، لا تستقبل
 * فقط.
 *
 * يُرسَل كلُّ حدثٍ مرّةً واحدة على الأقلّ (at-least-once) موقَّعاً بـHMAC:
 *   POST <webhook_url>
 *   X-Taki-Signature: sha256=<hex>      ← فوق الجسم الخام بسرٍّ لا يُعرض
 *   X-Taki-Event-Id:  <رقمٌ متزايد>      ← ليتجاهل نظامُهم التكرار
 *   { event_id, reason, deal_id, external_id, variant_id, location_id,
 *     delta, on_hand, barcode, occurred_at }
 *
 * 🪤 `reason` يقول **لماذا** تغيّر الرقم: `sale` خرجت قطعة · `refund` عادت ·
 *    `merchant` أعلن التاجر رقماً · `sync` جاء من نظامهم هم. وبلا السبب
 *    يستحيل على نظامهم أن يفرّق بين بيعٍ حقيقيّ وصدى دفعتِهم نفسها.
 *
 * 🪤 ولا يُستعمل `pg_net` لهذا: نداؤه «أطلِق وانسَ» — لا يقرأ الردّ ولا
 *    يُعيد المحاولة، و`handle_notification_push` يبتلع كلّ فشلٍ بصمت.
 *    وحدثٌ ضائع هنا = رقمُ مخزونٍ خاطئ عند التاجر. فالتسليمُ من عاملٍ يقرأ
 *    الردّ ويُعلّم النتيجة، بنفس نمط طابور البريد المُجرَّب على هذا الخادم.
 */

const dns = require('dns').promises;

const TIMEOUT_MS = 8000;
const BATCH = 20;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 v15.79 — عنوانُ الخطّاف يملكه **التاجر**، وتحقّقُ القاعدة كان
 *    `p_webhook_url !~ '^https://'` وحده: بادئةٌ لا مضيف. فتاجرٌ موثَّقٌ
 *    يحفظ `https://127.0.0.1:8000/` أو `https://10.0.1.147:8000/rest/v1/users`
 *    أو `https://169.254.169.254/`، ثم يُحرّك مخزونَ عرضِه هو، فيصير البوتُ
 *    يُرسل له POST **موقَّعاً من تاكي** من داخل شبكة Render — ونتيجةُ الطلب
 *    تُكتب في صفّ الحدث: `err = 'HTTP ' + res.status`، أي **عرّافُ حالاتٍ**
 *    يفرّق بين ٤٠١ و٤٠٤ و٢٠٠ ورفضِ الاتصال، فيُمسح به الداخلُ مضيفاً مضيفاً.
 *
 * 🪤 **والتحقّقُ وقتَ الحفظ لا يكفي أبداً**: DNS يُعاد توجيهُه بعد الحفظ،
 *    فنطاقٌ عامّ مرّ الفحصَ اليوم قد يُشير إلى `127.0.0.1` غداً (ولا يملك
 *    أحدٌ منعَ ذلك). ⇒ القرارُ **عند فتح المقبس**: يُحلَّل الاسم ويُرفض أيُّ
 *    جوابٍ محلّيّ أو خاصّ أو link-local أو RFC4193. والنصفُ الآخر (قيدُ
 *    القاعدة في `merchant_create_integration`/`merchant_update_integration`)
 *    يمنع حفظَ العنوان أصلاً، فالدفاعُ طبقتان لا طبقة.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function isPrivateAddr(ip, family) {
    const a = String(ip || '');
    if (family === 6 || a.includes(':')) {
        const h = a.toLowerCase();
        if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
        // 🪤 و`::ffff:127.0.0.1` عنوانٌ محلّيّ بثوبٍ سادس — وهو نفسُ الالتفاف
        //    الذي يحمله `GHSA-jqcg-44mw-7w3h`. يُقشَّر ويُفحص بالقواعد الرابعة.
        const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
        if (m) return isPrivateAddr(m[1], 4);
        return false;
    }
    const p = a.split('.').map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [x, y] = p;
    if (x === 0 || x === 10 || x === 127 || x >= 224) return true;
    if (x === 172 && y >= 16 && y <= 31) return true;
    if (x === 192 && y === 168) return true;
    if (x === 169 && y === 254) return true;               // بيانات وصف السحابة
    if (x === 100 && y >= 64 && y <= 127) return true;     // CGNAT — RFC6598
    return false;
}

/**
 * يُرجع سببَ الرفض، أو `null` إن جاز الاتصال. لا مقبسَ قبل هذا.
 * 🪤 ولا فحصَ نصّيّ على شكل المضيف إطلاقاً: `dns.lookup` يُطبّع الحرفيّات
 *    بنفسه — قِيس: `127.1` و`2130706433` كلاهما يعود `127.0.0.1`. وأيُّ
 *    تعبيرٍ نمطيّ هنا يتّهم البريء (`abc.def` كلُّه محارفُ ستّ عشرية).
 * 🪤 و**تبقى نافذةُ إعادةِ ربطِ DNS مفتوحةً نظرياً**: `fetch` يُحلّل الاسمَ
 *    ثانيةً بنفسه، فمهاجمٌ يملك نطاقاً بـTTL صفر قد يُبدّل الجوابَ بين
 *    فحصِنا واتصالِه. إغلاقُها يلزمه موزّعٌ مخصَّص (undici) يُثبّت العنوانَ
 *    ويمرّر `servername` لـTLS — حزمةٌ جديدة وسطحٌ جديد. فالدفاعُ طبقتان:
 *    قيدُ القاعدة يمنع **حفظَ** العنوان الداخليّ، وهذا يمنع تحليلَه إليه.
 *    ولا يُدّعى أكثرُ من ذلك.
 */
async function dialBlocked(rawUrl) {
    let u;
    try { u = new URL(String(rawUrl || '')); } catch { return 'bad url'; }
    if (u.protocol !== 'https:') return 'not https';
    let answers = null;
    try { answers = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true }); }
    catch { return null; }   // 🪤 اسمٌ لا يُحلَّل لا يصل شيئاً — و`fetch` سيفشل بنفسه
    // 🪤 ويُرفض إن كان **أيُّ** جوابٍ محلّياً لا إن كانت كلُّها: اسمٌ بجوابين
    //    أحدُهما عامٌّ والآخر `127.0.0.1` يُختار بينهما عشوائياً.
    if (answers.length && answers.some(a => isPrivateAddr(a.address, a.family))) return 'private host';
    return null;
}

/**
 * 🔴 v15.20 — لم يبقَ هنا توقيعٌ ولا بناءُ جسم، وذلك **إصلاحُ ثغرة**:
 *    `bot_pull_stock_events` كانت تُعيد `webhook_secret` نصّاً مع **كلّ حدث**،
 *    أي أن تسريبَ سرّ بوّابة البوت يصير قدرةً على انتحال تاكي أمام كلّ تاجر.
 *    فصار الجسمُ يُبنى ويُوقَّع **في القاعدة**، والسرُّ لا يخرج منها إطلاقاً.
 * 🪤 وهذا يُلغي أيضاً مصدرَي حقيقةٍ لشكل الجسم: `jsonb` لا يحفظ ترتيبَ
 *    المفاتيح، فمطابقةُ `JSON.stringify` بايتاً ببايت كانت وهماً. والآن
 *    كاتبٌ واحدٌ (القاعدة) ونقلٌ حرفيّ (هنا) — فالتوقيعُ فوق ما يُرسل فعلاً.
 */

/**
 * يسحب دفعةً ويُسلّمها. `rpc` هو غلافُ نداء القاعدة في البوت،
 * و`log` دالّةُ تسجيلٍ اختيارية.
 * 🪤 ولا يرمي أبداً: هذا يعمل داخل `setInterval`، واستثناءٌ غيرُ ملتقَط في
 *    مؤقّتٍ يُسقط العملية كلّها (ولذلك وُضعت حرّاسُ الانهيار في v11.90).
 */
async function drainStockEvents(rpc, log) {
    let sent = 0, failed = 0;
    try {
        const r = await rpc('bot_pull_stock_events', { p_limit: BATCH });
        const list = (r && r.ok && Array.isArray(r.events)) ? r.events : [];
        for (const ev of list) {
            if (!ev.webhook_url) {
                // اتصالٌ أُطفئ أو حُذف بين الكتابة والتسليم — يُعلَّم ولا يُعاد.
                await rpc('bot_mark_stock_event', { p_id: ev.id, p_ok: true, p_error: 'no endpoint' });
                continue;
            }
            // 🪤 ويُرسل `body_raw` **حرفياً**: أيُّ لمسٍ له (إعادةُ ترميزٍ أو
            //    مسافة) يُفسد التوقيعَ الذي حُسب فوقه في القاعدة.
            const raw = ev.body_raw;
            if (typeof raw !== 'string' || !raw || !ev.signature) {
                // 🔴 لا يُرسل حدثٌ بلا توقيع: نظامُ التاجر يرفضه بحقّ، والإرسالُ
                //    بلا توقيعٍ يُعلّمه أن يقبل غيرَ الموقَّع.
                await rpc('bot_mark_stock_event', { p_id: ev.id, p_ok: false, p_error: 'no signed body' });
                failed++; continue;
            }
            // 🔴 القرارُ قبل المقبس: يُحلَّل الاسم ويُرفض الجوابُ الداخليّ.
            const blocked = await dialBlocked(ev.webhook_url);
            if (blocked) {
                await rpc('bot_mark_stock_event', { p_id: ev.id, p_ok: false, p_error: 'endpoint not allowed' });
                if (log) log('stockSync refused endpoint:', blocked);   // السببُ في السجلّ لا في صفّ التاجر
                failed++; continue;
            }
            let ok = false, err = '';
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
                let res;
                // 🪤 و`clearTimeout` كان **قبل** قراءة أيّ شيء: نفسُ عيب
                //    `fetchWithTimeout` — فتُمسح المهلة عند الترويسات.
                try {
                    res = await fetch(ev.webhook_url, {
                        method: 'POST', signal: ctrl.signal, redirect: 'manual',
                        headers: {
                            'content-type': 'application/json',
                            'x-taki-signature': ev.signature,
                            'x-taki-event-id': String(ev.id),
                        },
                        body: raw,
                    });
                    try { await res.body?.cancel(); } catch { /* بلا جسم */ }
                } finally { clearTimeout(t); }
                // 🪤 و`redirect:'manual'`: تحويلٌ من نطاق التاجر إلى `127.0.0.1`
                //    يلتفّ على كلّ ما فوق — فالتحويلُ ليس تسليماً ولا يُتبع.
                ok = res.ok;
                // 🔴 وحالةُ المنبع لم تعد تُكتب في صفّ الحدث: كانت عرّافاً
                //    يفرّق ٤٠١ من ٤٠٤ من رفضِ الاتصال، فيُمسح به الداخل.
                //    والتاجرُ يحتاج «لم يُسلَّم» لا رقمَ حالةٍ لمضيفٍ ليس له.
                if (!ok) err = (res.status >= 300 && res.status < 400) ? 'redirect refused' : 'delivery failed';
            } catch (e) {
                // 🪤 ورسالةُ الاستثناء تحمل الاسمَ والعنوانَ والمنفذ
                //    (`ECONNREFUSED 10.0.1.147:8000`) — وهي نفسُ العرّاف.
                err = (e && e.name === 'AbortError') ? 'delivery timeout' : 'delivery failed';
            }
            await rpc('bot_mark_stock_event', { p_id: ev.id, p_ok: ok, p_error: ok ? null : err });
            if (ok) sent++; else failed++;
        }
    } catch (e) {
        if (log) log('stockSync drain failed:', String((e && e.message) || e));
    }
    return { sent, failed };
}

module.exports = { drainStockEvents, TIMEOUT_MS, BATCH };
// تُصدَّر للاختبار السالب وحده — ضابطٌ بلا اختبارٍ سالب ضابطٌ مجهول.
module.exports._internals = { dialBlocked, isPrivateAddr };

/**
 * يُشغّل مؤقّتَ التسليم. ⚠️ ويُنادى **خارج** أيّ شرطٍ يخصّ البريد:
 * عاملُ المخزون كان مُعشَّشاً في `if (mailer)` حتى v15.20، فمتجرٌ بلا بريدٍ
 * مضبوط لم يكن يُسلَّم له أيُّ حدثٍ أبداً — وأحداثُه تتراكم ثمّ تموت عند
 * ثامن محاولةٍ بلا أثر.
 */
function startStockWorker(rpc, log) {
    let busy = false;
    const tick = async () => {
        if (busy) return;                      // لا تتداخل الدفقات
        busy = true;
        try { await drainStockEvents(rpc, log); } finally { busy = false; }
    };
    setInterval(tick, 20_000).unref?.();
}

module.exports.startStockWorker = startStockWorker;
