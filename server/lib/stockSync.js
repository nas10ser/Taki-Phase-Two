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

const TIMEOUT_MS = 8000;
const BATCH = 20;

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
            let ok = false, err = '';
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
                const res = await fetch(ev.webhook_url, {
                    method: 'POST', signal: ctrl.signal,
                    headers: {
                        'content-type': 'application/json',
                        'x-taki-signature': ev.signature,
                        'x-taki-event-id': String(ev.id),
                    },
                    body: raw,
                });
                clearTimeout(t);
                ok = res.ok;
                if (!ok) err = 'HTTP ' + res.status;
            } catch (e) {
                err = String((e && e.message) || e).slice(0, 200);
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
