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

const crypto = require('crypto');

const TIMEOUT_MS = 8000;
const BATCH = 20;

/** توقيعُ الجسم الخام — لا كائناً مُعاد ترتيبه، فالترتيبُ يغيّر البصمة. */
function sign(raw, secret) {
    return 'sha256=' + crypto.createHmac('sha256', String(secret || '')).update(raw, 'utf8').digest('hex');
}

/** جسمُ الحدث كما يصل نظامَ التاجر. */
function body(ev) {
    return JSON.stringify({
        event_id: ev.id,
        reason: ev.reason,
        deal_id: ev.deal_id,
        external_id: ev.external_id || null,
        variant_id: ev.variant_id || null,
        location_id: ev.location_id || null,
        delta: ev.delta === undefined ? null : ev.delta,
        on_hand: ev.on_hand === undefined ? null : ev.on_hand,
        barcode: ev.barcode || null,
        occurred_at: ev.occurred_at,
    });
}

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
            const raw = body(ev);
            let ok = false, err = '';
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
                const res = await fetch(ev.webhook_url, {
                    method: 'POST', signal: ctrl.signal,
                    headers: {
                        'content-type': 'application/json',
                        'x-taki-signature': sign(raw, ev.webhook_secret),
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

module.exports = { drainStockEvents, sign, body, TIMEOUT_MS, BATCH };
