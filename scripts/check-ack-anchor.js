// حارسُ «الساعة تبدأ من تأكيد التاجر» (v15.44) — node scripts/check-ack-anchor.js
//
// ── ما يحرسه ───────────────────────────────────────────────────────────────
// أمرُ ناصر: «استلمت طلبي بعد ١٠ دقائق — من بعد ما يستلم التاجر الطلب ويضغط
// تم الاستلام، لا من بداية إرسال الطلب». فصارت هناك **حالةٌ ثالثة**: الساعةُ
// لم تبدأ بعد. وثلاثُ بيئاتٍ تحسبها (الموقع · البوتان · القاعدة)، وانحرافُ
// واحدةٍ يعني شاشةً تَعِد بما يرفضه الخادم.
//
// 🔴 ودرسُ v15.44 الأغلى: **مفتاحٌ موجودٌ بالاسم ليس مفتاحاً صالحاً بالقيمة.**
//    `booked_at` في ردّ `bot_get_my_bookings` مفتاحٌ موجود — لكنّه **نصُّ وقت**
//    (`to_timestamp`)، و`Number()` عليه NaN. فبوّابةُ v15.42 في القناتين كانت
//    تحسب NaN وتُرجع «لا انتظار» ⇒ الزرُّ يظهر فوراً والقاعدةُ ترفضه. ولذلك
//    يفحص هذا الحارسُ **قيمةَ** المرساة لا وجودَ اسمها.
const fs = require('fs');
const path = require('path');
const HOLDS = require('../server/lib/holds');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');
const stripSql = (s) => s.replace(/^--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

// ── ١) لحظةُ الفتح تُنفَّذ، ونسختا الموقع والبوت تتطابقان ──────────────────
const hold = R('src/utils/bookingHold.ts');
const m = hold.match(/export const selfCloseOpensAt = \(b: SelfCloseInput, minutes: number\): number => \{([\s\S]*?)\n\};/);
if (!m) { console.log('❌ لم يُعثر على selfCloseOpensAt في bookingHold.ts'); process.exit(1); }
// eslint-disable-next-line no-eval
const webOpens = eval(`(b, minutes) => {${m[1]}\n}`);
// وحالةُ الانتظار نفسُها (للتحقّق من دلالة الصفر في البيئات الثلاث)
const msState = hold.match(/export const selfCloseState = \([\s\S]*?\n\): SelfCloseState => \{([\s\S]*?)\n\};/);
const miAck = hold.match(/export const isAcknowledged = \(b: SelfCloseInput\): boolean =>\n([\s\S]*?);\n/);
if (!msState || !miAck) { console.log('❌ لم يُعثر على selfCloseState/isAcknowledged'); process.exit(1); }
// eslint-disable-next-line no-eval
const selfCloseState = eval(`(webOpens) => {
    const isAcknowledged = (b) => ${miAck[1].trim()};
    const selfCloseOpensAt = webOpens;
    return (b, minutes, nowMs) => {${msState[1].replace(/\(isRTL: boolean\)/g, '(isRTL)')}
    };
}`)(webOpens);

const NOW = 1_700_000_000_000;
const M = 10, MS = M * 60000;
// 🔴 الحالةُ الثالثة (الفتحةُ الاحتياطيّة) هي التي أسقطت الصيغةَ الأولى من
//    v15.44: بدونها تبقى ١٤٪ من الطلبات بلا مخرجٍ للمشتري أبداً (قِيس على جدّة).
const CASES = [
    ['أكّد التاجر ⇒ بعد المهلة من تأكيده',
     { status: 'acknowledged', acknowledgedAt: NOW, bookedAt: NOW - 99000, expiryTime: NOW + 7200000 }, NOW + MS],
    ['صفٌّ قديمٌ أُكّد بلا ختم ⇒ من لحظة الحجز',
     { status: 'acknowledged', bookedAt: NOW, expiryTime: NOW + 7200000 }, NOW + MS],
    ['لم يؤكّد · مهلةٌ طويلة ⇒ آخرُ المهلة',
     { status: 'pending', bookedAt: NOW, expiryTime: NOW + 7200000 }, NOW + 7200000 - MS],
    ['لم يؤكّد · مهلةٌ قصيرة ⇒ لا قبل المهلة من الحجز',
     { status: 'pending', bookedAt: NOW, expiryTime: NOW + 15 * 60000 }, NOW + MS],
    ['لم يؤكّد · حجزٌ قديم ومهلةٌ توشك ⇒ مفتوحٌ الآن',
     { status: 'pending', bookedAt: NOW - 20 * 60000, expiryTime: NOW + 9 * 60000 }, NOW - 60000],
    // 🔴 v15.47 — والتأكيدُ المتأخّر لا يؤجّل: تُؤخذ الأسبقُ من المرساتين.
    //    هنا الاحتياطيّةُ (الحجز+١٠د = +٤د) أسبقُ من مرساة التأكيد (+١٠د).
    ['أكّد متأخّراً ⇒ تُؤخذ الأسبق (الاحتياطيّة)',
     { status: 'acknowledged', acknowledgedAt: NOW, bookedAt: NOW - 6 * 60000, expiryTime: NOW + 9 * 60000 },
     NOW + 4 * 60000],
];
for (const [name, b, want] of CASES) {
    const got = webOpens(b, M);
    check(`الموقع: ${name}`, got === want, `المتوقّع ${want} والناتج ${got} (فارق ${got - want}ms)`);
}

const toBot = (b) => ({ status: b.status, ack_at_ms: b.acknowledgedAt, booked_at_ms: b.bookedAt, expiry_time: b.expiryTime });
for (const [name, b, want] of CASES) {
    const got = HOLDS.selfCloseOpensAt(toBot(b), M);
    check(`البوت: ${name}`, got === want, `المتوقّع ${want} والناتج ${got}`);
}

// 🔴 والقيمةُ رقمٌ لا نصّ: هذا هو العيبُ الذي قتل بوّابةَ v15.42 في القناتين.
check('ونصُّ وقتٍ مكان الرقم لا يُقبل صامتاً',
    Number.isFinite(HOLDS.selfCloseOpensAt({ status: 'acknowledged', ack_at_ms: '2026-11-02T18:00:00+00:00', booked_at_ms: 'x' }, M)),
    'نصٌّ غير رقميّ يجب ألّا يُنتج NaN');

// ── ٢) حالتان معروضتان: أنتظرُ شخصاً أم وقتاً ──────────────────────────────
(async () => {
    const st = async (b) => HOLDS.selfCloseState(toBot(b), 'ar', NOW);
    const a = await st({ status: 'pending', bookedAt: NOW, expiryTime: NOW + 7200000 });
    check('لم يؤكّد ⇒ انتظارٌ بسببِ شخص', !!a && a.acknowledged === false, JSON.stringify(a));
    const w = await st({ status: 'acknowledged', acknowledgedAt: NOW, bookedAt: NOW, expiryTime: NOW + 7200000 });
    check('أكّد ⇒ انتظارٌ بسببِ وقت، بصياغةٍ عربية سليمة',
        !!w && w.acknowledged === true && w.seconds === 600 && w.label === '10 دقائق', JSON.stringify(w));
    // 🪤 والحجزُ يسبق التأكيدَ دائماً في الواقع؛ وأرضيّةُ «لا قبل المهلة من
    //    الحجز» تردُّ العكسَ بحقّ — وقد أسقطت أوّلَ صيغةٍ لهذا الاختبار.
    check('بعد الفتح ⇒ الزرّ',
        (await st({ status: 'acknowledged', acknowledgedAt: NOW - 11 * 60000,
                    bookedAt: NOW - 12 * 60000, expiryTime: NOW + 7200000 })) === null);
    // 🔴 الرتابة: التأكيدُ لا يؤخّر الفتحَ أبداً — كان يسحب زرّاً من يد
    //    المشتري (عيبُ v15.44، كشفه الفحصُ المستقلّ).
    let regressed = null;
    for (let holdMin = 15; holdMin <= 135 && !regressed; holdMin += 6) {
        for (let ackMin = 0; ackMin <= holdMin; ackMin += 3) {
            const base = { bookedAt: NOW, expiryTime: NOW + holdMin * 60000 };
            const before = webOpens({ ...base, status: 'pending' }, M);
            const after = webOpens({ ...base, status: 'acknowledged', acknowledgedAt: NOW + ackMin * 60000 }, M);
            if (after > before) { regressed = `مهلة ${holdMin}د وتأكيدٌ بعد ${ackMin}د: ${before} ⇐ ${after}`; break; }
        }
    }
    check('التأكيدُ يُعجّل الفتحَ ولا يؤجّله (كلُّ تركيبة)', regressed === null, regressed);

    // 🔴 العقدُ الحاسم: لحظةُ الفتح **قبل** انتهاء المهلة دائماً، مهما كان
    //    طولُ المهلة ولا متى أكّد التاجر. تُجرَّب ٤٠٠ تركيبة.
    let empty = null;
    for (let holdMin = 15; holdMin <= 135 && !empty; holdMin += 6) {
        for (let ackMin = 0; ackMin <= 20; ackMin += 1) {
            const b = { status: 'acknowledged', bookedAt: NOW,
                        acknowledgedAt: NOW + ackMin * 60000, expiryTime: NOW + holdMin * 60000 };
            if (webOpens(b, M) >= b.expiryTime) { empty = `مهلة ${holdMin}د وتأكيدٌ بعد ${ackMin}د`; break; }
        }
    }
    check('النافذةُ موجودةٌ في كلّ تركيبةِ مهلةٍ وتأكيد (٤٠٠ حالة)', empty === null, empty);

    // 🔴 v15.46 — صفرُ المهلة يعني «بلا مهلة» في البيئات الثلاث جميعاً.
    //    كان الموقعُ والبوت يُرجعان «مفتوح» عند الصفر بينما القاعدةُ تحسب
    //    `GREATEST(booked, expiry)` فتُنتج **أطولَ انتظارٍ ممكن** — فتعرض
    //    الشاشةُ زرّاً يرفضه الخادم.
    check('صفرُ المهلة: الموقعُ يفتح فوراً', selfCloseState({ status: 'pending', bookedAt: NOW, expiryTime: NOW + 7200000 }, 0, NOW) === null);
    // 🪤 ونسخةُ البوت تقرأ الدقائقَ من إعدادات المنصّة لا من وسيط، فلا تُمرَّر
    //    لها صفراً في اختبار. يُفحص فرعُها نصّاً — وهو الممكنُ الصادق هنا.
    check('صفرُ المهلة: وفرعُ البوت موجود',
        /if \(!\(h\.selfClose > 0\)\) return null;/.test(strip(R('server/lib/holds.js'))));
    check('والهجرةُ تجعل القاعدةَ توافقهما',
        /taki_self_close_minutes\(\) <= 0/.test(stripSql(R('supabase/JEDDAH_v15_46_store_profile_column_guard.sql'))),
        'بدونها يختلف الخادمُ عن الشاشة عند الصفر');

    check('ولا يبقى طلبٌ بلا مخرجٍ أبداً',
        (await st({ status: 'pending', bookedAt: NOW - 20 * 60000, expiryTime: NOW + 9 * 60000 })) === null);

    // ── ٣) الواجهاتُ تقول الحالتين بنصّين مختلفين ──────────────────────────
    const notice = strip(R('src/components/SelfCloseNotice.tsx'));
    check('بوّابةُ الواجهة تفرّق الحالتين', /state\.acknowledged/.test(notice) && /beforeAck/.test(notice));
    check('والنبضُ يتوقّف من تلقاء نفسه بعد الفتح', /const ticking = !!state;/.test(notice));
    for (const f of ['src/pages/Bookings.tsx', 'src/components/seller/OrderCloseActions.tsx']) {
        const src = strip(R(f));
        check(`${f.split('/').pop()}: يمرّر نصَّ ما قبل التأكيد`, /beforeAck=/.test(src));
        check(`${f.split('/').pop()}: يمرّر الطلبَ لا لحظةَ الحجز`, /booking=\{|booking=\{order\}/.test(src) && !/bookedAt=\{/.test(src));
    }
    // 🔴 والقيمةُ **رقمُ مللي** لا اسمٌ فقط: عيبُ v15.42 كان مفتاحاً موجوداً
    //    بالاسم يحمل **نصَّ وقت**، و`Number()` عليه NaN. فحصٌ يسأل عن الاسم
    //    وحده كان سيمرّ على ذلك العيب بعينه.
    const repo = strip(R('src/repositories/bookingRepository.ts'));
    // 🪤 و**كلُّ** موضعٍ لا موضعٌ واحد: المُحوِّل مكرَّرٌ ثلاث مرّات في الملفّ
    //    (الصفحةُ · الترقيم · الصفُّ المفرد)، وكسرُ واحدٍ منها كان يمرّ لأن
    //    الباقي يُرضي النمط. يُعدّ الاسمُ ويُعدّ التحويلُ ويُشترط تساويهما.
    const named = (repo.match(/acknowledgedAt:\s*\w+\.acknowledged_at/g) || []).length;
    const converted = (repo.match(/acknowledgedAt:\s*\w+\.acknowledged_at \? new Date\([^)]*\)\.getTime\(\)/g) || []).length;
    check('كلُّ مُحوِّلٍ يُرجع **رقمَ مللي** لا نصَّ وقت',
        named > 0 && named === converted,
        `مواضعُ الاسم ${named} · المحوَّلةُ منها ${converted} — الفارقُ NaN صامت`);
    check('ونهايةُ المهلة رقمٌ كذلك', /expiryTime: b\.expiry_time/.test(repo));
    // وفي ردّ البوتين: مفتاحٌ رقميٌّ صريح لا `to_timestamp`
    const migAck = stripSql(R('supabase/JEDDAH_v15_44_ack_anchor_and_pay_truth.sql'));
    check('وردُّ البوتين يحمل مللي صريحة لا نصَّ وقت',
        /'ack_at_ms',\s*CASE WHEN b\.acknowledged_at IS NULL THEN NULL[\s\S]{0,120}EXTRACT\(EPOCH FROM b\.acknowledged_at\)\*1000/.test(migAck),
        'المفتاحُ موجودٌ بالاسم لا يكفي — تُقاس القيمة');

    // ── ٤) البوتان معاً ─────────────────────────────────────────────────────
    for (const f of ['server/bot.js', 'server/flows/whatsapp.js']) {
        const src = strip(R(f));
        const n = f.split('/').pop();
        check(`${n}: يستعمل الحالةَ الثلاثية`, /HOLDS\.selfCloseState\(/.test(src));
        check(`${n}: ولم تبقَ selfCloseLeft`, !/selfCloseLeft/.test(src));
        check(`${n}: يختار النصَّ حسب الحالة`, /b_confirm_receipt_before_ack/.test(src));
    }
    check('ورمزُ not_acknowledged مربوطٌ برسالته',
        HOLDS.receiptErrKey('not_acknowledged') === 'b_confirm_receipt_not_acked');
    const i18n = JSON.parse(R('server/lib/i18n-data.json'));
    for (const k of ['b_confirm_receipt_not_acked', 'b_confirm_receipt_before_ack']) {
        check(`سلسلةُ ${k} بالعربية والإنجليزية`, !!i18n[k]?.ar && !!i18n[k]?.en, JSON.stringify(i18n[k] || null));
    }

    // ── ٥) القاعدةُ هي الحَكَم ──────────────────────────────────────────────
    const mig = stripSql(R('supabase/JEDDAH_v15_44_ack_anchor_and_pay_truth.sql'));
    // 🪤 وكلُّ فحصٍ نصّيٍّ يقتصر على **أجسام الدوالّ** دون كتلة التحقّق: تلك
    //    تبحث عن نفس الرموز فتُبقيها حيّةً في النصّ ولو مات الكودُ الحقيقيّ.
    //    وقعت ثلاث مرّات في هذا الملفّ وحده — وكُشفت بكسرةٍ لم تكسر.
    const migBodies = mig.slice(0, mig.indexOf('DO $verify$'));
    check('الهجرة: عمودُ لحظة التأكيد', /ADD COLUMN IF NOT EXISTS acknowledged_at/.test(mig));
    check('الهجرة: مشغّلٌ يختمها ويحفظ القديمة', /tr_ag_stamp_ack/.test(migBodies) && /OLD\.acknowledged_at/.test(migBodies));
    // 🪤 ولا يُقارَن توقيتان مختلفان: `tr_af_…` مشغّلُ AFTER وهذا BEFORE،
    //    والترتيبُ الأبجديّ يسري داخل كلِّ توقيتٍ وحده. (تعليقٌ خاطئ صُحِّح.)
    check('ولا يدّعي ترتيباً بين توقيتين مختلفين',
        !/بعد\*\*\s*`tr_af_order_invoice_draft`/.test(mig) && !/ليقع \*\*بعد\*\* `tr_af_order_invoice_draft`/.test(mig));
    check('الهجرة: لحظةُ الفتح دالّةٌ واحدة', /taki_self_close_opens_at/.test(migBodies));
    // 🪤 ويُستثنى نصُّ كتلة التحقّق نفسِها: هي تبحث عن العبارة فتعدّ نفسَها
    //    رابعةً — وهو نفسُ فخّ «الحارسُ يقرأ تعليقَه» بثوبٍ آخر.
    check('الهجرة: البوّابات الثلاث تفرّق «لم يؤكّد»',
        (migBodies.match(/v_b\.acknowledged_at IS NULL/g) || []).length === 3,
        'العدد ' + (migBodies.match(/v_b\.acknowledged_at IS NULL/g) || []).length);
    check('الهجرة: ردُّ البوتين يحمل مرساةً رقميّة', /ack_at_ms/.test(migBodies) && /booked_at_ms/.test(migBodies));
    check('الهجرة: تحقّقٌ سلوكيّ يشمل الفتحةَ الاحتياطيّة',
        /DO \$behave\$/.test(mig) && /ومهلتُه توشك/.test(mig));

    // ── ٦) طريقةُ الحساب: حقيقةٌ واحدة، والبطاقةُ الثالثة ذهبت بأمان ───────
    check('الهجرة: حارسُ النقد يقرأ ما يراه المشتري', /deal_payment_mode\(NEW\.store_id\)/.test(migBodies));
    check('الهجرة: مزامنةُ الإقرار بمشغّل', /tr_sync_accepts_cod/.test(migBodies));
    // 🔴 ولا يُقِرُّ المشغّلُ عمّن لم ينطق: `payment_modes` افتراضُها 'cod' NOT NULL
    //    و`merchant_set_gateway` لا تذكرها، فـ`INSERT` كان يختم إقراراً لم يُقل.
    check('الهجرة: المشغّلُ على UPDATE وحده لا INSERT',
        /AFTER UPDATE OF payment_modes/.test(migBodies) && !/AFTER INSERT OR UPDATE OF payment_modes/.test(migBodies));
    check('الهجرة: ولا يختم payment_declared_at عن أحد',
        /payment_declared_at IS NOT NULL/.test(migBodies)
        && !/payment_declared_at = COALESCE\(payment_declared_at, now\(\)\)/.test(migBodies));
    check('الهجرة: كاشفُ الانحراف موجود', /taki_audit_payment_drift/.test(mig));
    const pdc = strip(R('src/components/seller/PaymentDeclarationCard.tsx'));
    check('بطاقةُ الإقرار تختفي بعد الإقرار', /if \(snap\.ok\) return null;/.test(pdc));
    // 🔴 ولا تختفي قبله: هي الطريقُ الوحيد لإقرارِ متجرٍ بلا بوّابة.
    check('وتبقى كاملةً قبل الإقرار (وإلّا تجمّد كلُّ متجرٍ نقديّ)',
        /if \(!snap\.ok\)/.test(pdc) && /merchant_set_payment_declaration/.test(pdc));
    check('ولا بقايا للسطر المحذوف', !/طريقة الحساب:/.test(pdc) && !/setEditing/.test(pdc));
    // 🪤 ويُجرَّد التعليقُ أوّلاً: شرحُ هذا التغيير نفسُه يذكر اسمَ البطاقة
    //    المحذوفة، فحارسٌ ساذج يتّهم النصَّ الذي يحرسه (v15.22 · v15.40).
    check('ولا نصَّ يُحيل إلى بطاقةٍ لم تعد تظهر',
        !/بطاقة «طريقة الحساب»/.test(strip(R('src/components/seller/DeliveryCard.tsx'))));
    check('ومرساةُ قائمة الانطلاق باقية',
        /id="setup-pay"/.test(R('src/pages/SellerDashboard.tsx')));

    console.log(`${fail ? '❌' : '✅'} ساعةُ التأكيد وطريقةُ الحساب: ${pass + fail} فحصاً`);
    process.exit(fail ? 1 : 0);
})();
