#!/usr/bin/env node
/**
 * test-stock-sync.js — تسليمُ حركات المخزون إلى نظام التاجر (v15.08 → v15.20)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 حدثٌ ضائعٌ هنا = رقمُ مخزونٍ خاطئ عند التاجر، وهو لا يعلم. ولذلك يُفحص
 *    سلوكُ العامل لا شكلُه: هل يُعلّم كلَّ حدثٍ يسحبه؟ وهل ينجو من ردٍّ
 *    فاشل؟ وهل يرمي داخل مؤقّتٍ فيُسقط البوت كلَّه؟
 *
 * 🔴 وv15.20 نقلت التوقيعَ وبناءَ الجسم إلى **القاعدة**، وهذا إصلاحُ ثغرة:
 *    `bot_pull_stock_events` كانت تُعيد `webhook_secret` نصّاً مع كلّ حدث،
 *    أي أن تسريبَ سرّ بوّابة البوت يصير قدرةً على انتحال تاكي أمام كلّ تاجر.
 *    ⇒ فالمفحوصُ هنا تغيّر: لم يبقَ للبوت توقيعٌ يُختبر، والمطلوبُ منه
 *      **نقلٌ حرفيّ** (أيُّ لمسٍ للجسم يُفسد توقيعَ القاعدة) و**رفضُ** أيّ
 *      حدثٍ يصل بلا جسمٍ موقَّع.
 */
const assert = require('assert');
const { drainStockEvents, startStockWorker } = require('../server/lib/stockSync');

let pass = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };

(async () => {
    // ── ١) 🔴 الجسمُ يُنقل **حرفياً** والتوقيعُ كما جاء ────────────────────
    //    وأيُّ إعادة ترميزٍ (JSON.parse ثمّ stringify) تغيّر البايتات فتفشل
    //    المطابقة عند التاجر — وهو فشلٌ صامتٌ تماماً من طرفنا.
    const RAW = '{"on_hand": 4, "deal_id": "d1", "event_id": 7, "external_id": "SKU-9", "reason": "refund"}';
    const SIG = 'sha256=' + 'a'.repeat(64);
    let seen = null;
    const marks = [];
    const rpcOne = async (fn, args) => {
        if (fn === 'bot_pull_stock_events') {
            return { ok: true, events: [{ id: 7, store_id: 's1',
                webhook_url: 'https://merchant.invalid/hook', body_raw: RAW, signature: SIG }] };
        }
        if (fn === 'bot_mark_stock_event') { marks.push(args); return { ok: true }; }
        return null;
    };
    const origFetch = global.fetch;
    global.fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200 }; };
    await drainStockEvents(rpcOne, () => {});
    global.fetch = origFetch;

    assert.ok(seen, 'لم يُرسل الحدثُ إطلاقاً');
    assert.strictEqual(seen.init.body, RAW, 'الجسمُ لم يُنقل حرفياً — التوقيعُ محسوبٌ فوق بايتاته بالضبط');
    assert.strictEqual(seen.init.headers['x-taki-signature'], SIG, 'التوقيعُ لم يُمرَّر كما جاء من القاعدة');
    assert.strictEqual(seen.init.headers['x-taki-event-id'], '7', 'معرّفُ الحدث مفقود — لا يستطيعون تجاهل التكرار');
    ok('الجسمُ يُنقل حرفياً · والتوقيعُ ومعرّفُ الحدث يُمرَّران');

    // ── ٢) 🔴 ولا يخرج السرُّ من القاعدة: لا شيءَ هنا يوقّع ────────────────
    // 🪤 وتُجرَّد التعليقاتُ أوّلاً: أوّلُ صياغةٍ لهذا الفحص فشلت لأنها أمسكت
    //    **تعليقَها هو** (الذي يشرح الثغرة ويذكر اسمَ الحقل). وهو فخٌّ مسجَّلٌ
    //    في هذا المشروع مرّتين: حارسٌ يتّهم النصَّ الذي يحرسه.
    const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const src = strip(require('fs').readFileSync(
        require('path').join(__dirname, '..', 'server/lib/stockSync.js'), 'utf8'));
    assert.ok(!/createHmac/.test(src), 'البوتُ ما زال يوقّع — أي أن السرَّ ما زال يخرج من القاعدة');
    assert.ok(!/webhook_secret/.test(src), 'البوتُ ما زال يقرأ webhook_secret');
    ok('لا توقيعَ ولا سرَّ في البوت');

    // ── ٣) 🔴 وحدثٌ بلا جسمٍ موقَّع لا يُرسل أبداً ─────────────────────────
    //    وإرسالُه بلا توقيعٍ يُعلّم نظامَ التاجر أن يقبل غيرَ الموقَّع.
    let sent = 0;
    const marks3 = [];
    const rpcBad = async (fn, args) => {
        if (fn === 'bot_pull_stock_events') {
            return { ok: true, events: [
                { id: 11, webhook_url: 'https://m.invalid/h', body_raw: RAW, signature: null },
                { id: 12, webhook_url: 'https://m.invalid/h', body_raw: null, signature: SIG },
                { id: 13, webhook_url: null, body_raw: RAW, signature: SIG },
            ] };
        }
        if (fn === 'bot_mark_stock_event') { marks3.push(args); return { ok: true }; }
        return null;
    };
    global.fetch = async () => { sent++; return { ok: true, status: 200 }; };
    const r3 = await drainStockEvents(rpcBad, () => {});
    global.fetch = origFetch;
    assert.strictEqual(sent, 0, 'أُرسل حدثٌ بلا جسمٍ موقَّع');
    assert.strictEqual(marks3.length, 3, `عُلّم ${marks3.length} من ثلاثة — حدثٌ مسحوبٌ بلا علامة يبقى معلّقاً إلى الأبد`);
    assert.strictEqual(marks3.find(m => m.p_id === 11).p_ok, false, 'حدثٌ بلا توقيعٍ سُجّل نجاحاً');
    assert.strictEqual(marks3.find(m => m.p_id === 12).p_ok, false, 'حدثٌ بلا جسمٍ سُجّل نجاحاً');
    assert.strictEqual(marks3.find(m => m.p_id === 13).p_ok, true, 'حدثٌ بلا وجهةٍ يجب أن يُغلق لا أن يُعاد');
    assert.strictEqual(r3.failed, 2, 'عدّادُ الفشل خاطئ');
    ok('حدثٌ بلا جسمٍ موقَّع لا يُرسل ويُعلَّم فشلاً · وبلا وجهةٍ يُغلق');

    // ── ٤) فشلُ الشبكة يُسجّل فشلاً ولا يضيع الحدث ────────────────────────
    const marks4 = [];
    const rpc4 = async (fn, args) => {
        if (fn === 'bot_pull_stock_events') {
            return { ok: true, events: [{ id: 21, webhook_url: 'https://m.invalid/h', body_raw: RAW, signature: SIG }] };
        }
        if (fn === 'bot_mark_stock_event') { marks4.push(args); return { ok: true }; }
        return null;
    };
    global.fetch = async () => { throw new Error('network down'); };
    const r4 = await drainStockEvents(rpc4, () => {});
    global.fetch = origFetch;
    assert.strictEqual(marks4.length, 1, 'حدثٌ مسحوبٌ بلا علامة');
    assert.strictEqual(marks4[0].p_ok, false, 'فشلُ الشبكة سُجّل نجاحاً');
    assert.strictEqual(r4.failed, 1, 'عدّادُ الفشل خاطئ');
    ok('فشلُ الشبكة سُجّل فشلاً — والحدثُ لا يضيع');

    // ── ٥) 🔴 ولا يرمي أبداً: هذا داخل setInterval ────────────────────────
    const throwing = async () => { throw new Error('db gone'); };
    const r5 = await drainStockEvents(throwing, () => {});
    assert.deepStrictEqual(r5, { sent: 0, failed: 0 }, 'العامل رمى بدل أن يبتلع');
    ok('انهيارُ القاعدة لا يُسقط البوت (استثناءٌ في مؤقّتٍ يقتل العملية)');

    // ── ٦) 🔴 والجدولةُ موجودةٌ ومستقلّةٌ عن البريد ───────────────────────
    //    كان المؤقّتُ مُعشَّشاً في `if (mailer)` فمتجرٌ بلا بريدٍ مضبوط لا
    //    يُسلَّم له أيُّ حدثٍ أبداً — وأحداثُه تموت عند ثامن محاولة بلا أثر.
    assert.strictEqual(typeof startStockWorker, 'function', 'لا مُجدوِلَ للعامل');
    const bot = require('fs').readFileSync(require('path').join(__dirname, '..', 'server/bot.js'), 'utf8');
    const at = bot.indexOf('startStockWorker');
    assert.ok(at > 0, 'البوتُ لا يُجدول عاملَ المخزون');
    // السطرُ الذي يُجدوله يجب ألّا يكون داخل كتلة `if (mailer) {`
    const before = bot.slice(0, at);
    const lastIf = before.lastIndexOf('if (mailer) {');
    const lastClose = before.lastIndexOf('\n    }');
    assert.ok(lastClose > lastIf, 'جدولةُ عامل المخزون داخل `if (mailer)` — متجرٌ بلا بريدٍ لا يُسلَّم له شيء');
    ok('عاملُ المخزون مُجدوَلٌ خارج شرط البريد');

    console.log(`✅ تسليم المخزون: ${pass} فحصاً — نقلٌ حرفيّ · لا سرَّ في البوت · لا حدثَ يضيع · ولا رمي داخل مؤقّت`);
})().catch(e => { console.error('\n❌ فشل اختبار تسليم المخزون:\n   ' + e.message + '\n'); process.exit(1); });
