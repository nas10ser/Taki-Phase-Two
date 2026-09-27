#!/usr/bin/env node
/**
 * test-stock-sync.js — تسليمُ حركات المخزون إلى نظام التاجر (v15.08)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 حدثٌ ضائعٌ هنا = رقمُ مخزونٍ خاطئ عند التاجر، وهو لا يعلم. ولذلك يُفحص
 *    سلوكُ العامل لا شكلُه: هل يُعلّم كلَّ حدثٍ يسحبه؟ وهل ينجو من ردٍّ
 *    فاشل؟ وهل يرمي داخل مؤقّتٍ فيُسقط البوت كلَّه؟
 */
const assert = require('assert');
const { drainStockEvents, sign, body } = require('../server/lib/stockSync');

let pass = 0;
const ok = (m) => { pass++; console.log('  ✓', m); };

(async () => {
    // ── ١) التوقيعُ فوق الجسم الخام، لا فوق كائنٍ يُعاد ترتيبه ───────────
    const raw = '{"a":1,"b":2}';
    assert.strictEqual(sign(raw, 'k'), sign(raw, 'k'), 'التوقيع غير مستقرّ');
    assert.notStrictEqual(sign(raw, 'k'), sign('{"b":2,"a":1}', 'k'),
        'التوقيع لا يتأثّر بترتيب المفاتيح — أي أنه لا يوقّع الجسم الخام');
    assert.notStrictEqual(sign(raw, 'k'), sign(raw, 'k2'), 'السرّ لا يؤثّر');
    assert.ok(/^sha256=[0-9a-f]{64}$/.test(sign(raw, 'k')), 'صيغة التوقيع خاطئة');
    ok('التوقيع: مستقرٌّ · فوق الجسم الخام · ويتبع السرّ');

    // ── ٢) الجسمُ يحمل **السبب** والكودَ الخارجيّ ─────────────────────────
    const b = JSON.parse(body({ id: 7, reason: 'refund', deal_id: 'd1', external_id: 'SKU-9',
        delta: 2, on_hand: 20, barcode: '123', occurred_at: '2026-09-27T00:00:00Z' }));
    assert.strictEqual(b.reason, 'refund', 'السبب مفقود — نظامُهم لن يفرّق بين بيعٍ وصدى دفعتِه');
    assert.strictEqual(b.external_id, 'SKU-9', 'الكودُ الخارجيّ مفقود — لن يعرفوا أيّ منتجٍ تغيّر');
    assert.strictEqual(b.event_id, 7, 'معرّفُ الحدث مفقود — لا يستطيعون تجاهل التكرار');
    ok('الجسم: سببٌ · كودٌ خارجيّ · معرّفُ حدث');

    // ── ٣) كلُّ حدثٍ يُسحب يُعلَّم — نجح أم فشل ───────────────────────────
    const marks = [];
    const fakeRpc = async (fn, args) => {
        if (fn === 'bot_pull_stock_events') return { ok: true, events: [
            { id: 1, reason: 'sale', deal_id: 'd', webhook_url: 'https://x.invalid/a', webhook_secret: 's', occurred_at: 'now' },
            { id: 2, reason: 'sale', deal_id: 'd', webhook_url: null, occurred_at: 'now' },
        ] };
        if (fn === 'bot_mark_stock_event') { marks.push(args); return { ok: true }; }
        return null;
    };
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('network down'); };
    const r1 = await drainStockEvents(fakeRpc, () => {});
    global.fetch = origFetch;
    assert.strictEqual(marks.length, 2, `عُلّم ${marks.length} من حدثين — حدثٌ مسحوبٌ بلا علامة يبقى معلّقاً إلى الأبد`);
    assert.strictEqual(marks.find(m => m.p_id === 1).p_ok, false, 'فشلُ الشبكة سُجّل نجاحاً');
    assert.strictEqual(marks.find(m => m.p_id === 2).p_ok, true, 'حدثٌ بلا وجهةٍ يجب أن يُغلق لا أن يُعاد');
    assert.strictEqual(r1.failed, 1, 'عدّادُ الفشل خاطئ');
    ok('كلُّ حدثٍ مسحوبٍ عُلّم — والفشلُ سُجّل فشلاً');

    // ── ٤) 🔴 ولا يرمي أبداً: هذا داخل setInterval ────────────────────────
    const throwing = async () => { throw new Error('db gone'); };
    const r2 = await drainStockEvents(throwing, () => {});
    assert.deepStrictEqual(r2, { sent: 0, failed: 0 }, 'العامل رمى بدل أن يبتلع');
    ok('انهيارُ القاعدة لا يُسقط البوت (استثناءٌ في مؤقّتٍ يقتل العملية)');

    console.log(`✅ تسليم المخزون: ${pass} فحصاً — توقيعٌ خام · سببٌ وكود · لا حدثَ يضيع · ولا رمي داخل مؤقّت`);
})().catch(e => { console.error('\n❌ فشل اختبار تسليم المخزون:\n   ' + e.message + '\n'); process.exit(1); });
