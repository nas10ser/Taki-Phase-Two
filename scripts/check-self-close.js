// حارسُ «مهلة الختم بلا كود» (v15.42) — التشغيل: node scripts/check-self-close.js
//
// ── العيبُ الذي يحرسه ──────────────────────────────────────────────────────
// v15.41 أعطت المشتري زرَّ «استلمتُ طلبي» لطلبات الاستلام، وهو يظهر **لحظةَ
// الحجز**. فمشترٍ يضغطه من بيته يُختم طلبُه «مكتملاً»: تُصدَر فاتورتُه
// الضريبيّة ويُخصم المخزون ويفقد حقَّ الإلغاء — وهو لم يذهب إلى المتجر.
// وأمرُ ناصر: لا يظهر إلا بعد عشر دقائق، وللتاجر اختصارٌ مثلُه.
//
// 🔴 والدرسُ الأهمّ من هذا الإصدار: **الفحصُ النصّيّ لا يُثبت حياةَ حارس.**
//    كسرةٌ تُبقي اسمَ الدالّة ورمزَ الخطأ مكتوبين وتُصفّر المتبقّي قبلهما
//    تمرّ على أيّ فحصٍ يبحث عن نصّ. ⇒ الحسابُ هنا يُقاس **تنفيذاً**، والبنيةُ
//    وحدها هي ما يُفحص نصّياً. والإثباتُ السلوكيّ على القاعدة في
//    `supabase/JEDDAH_v15_42_self_close_delay.sql` (كتلة `DO $behave$`).
//
// 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ: هذا الملفُّ نفسُه يحوي «10 دقائق».
const fs = require('fs');
const path = require('path');
const HOLDS = require('../server/lib/holds');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

// ── ١) الحسابُ يُقاس تنفيذاً: نسخةُ الموقع (TS) تُستخرج وتُنفَّذ ───────────
const holdSrc = R('src/utils/bookingHold.ts');
const m = holdSrc.match(/export const selfCloseLeft = \(([\s\S]*?)\n\};/);
if (!m) { console.log('❌ لم يُعثر على selfCloseLeft في src/utils/bookingHold.ts'); process.exit(1); }
const tsBody = ('(' + m[1] + '\n}')
    .replace(/:\s*number\s*\|\s*null\s*\|\s*undefined/g, '')
    .replace(/:\s*\{\s*seconds: number; label: \(isRTL: boolean\) => string\s*\}\s*\|\s*null/g, '')
    .replace(/\(isRTL:\s*boolean\)/g, '(isRTL)')
    .replace(/:\s*number/g, '')
    .replace(/:\s*boolean/g, '');
// 🪤 ويُنفَّذ بمحرّك الجمع نفسِه لا ببديلٍ مزيَّف: الصياغةُ جزءٌ من العقد.
const { arCount, enCount } = require('../shared/arPlural');
const minutesLabelGen = (n, isRTL) => (isRTL ? arCount(n, 'minutes', true) : enCount(n, 'minute', 'minutes'));
let selfCloseLeft;
try {
    // eslint-disable-next-line no-eval
    selfCloseLeft = eval(`(minutesLabelGen) => ${tsBody}`)(minutesLabelGen);
} catch (e) {
    console.log('❌ تعذّر تنفيذ selfCloseLeft المستخرجة: ' + e.message);
    process.exit(1);
}

const NOW = 1_700_000_000_000;
const CASES = [
    ['لحظةَ الحجز: محجوب', NOW, 10, NOW, 600],
    ['بعد ٩ دقائق: محجوبٌ بدقيقة', NOW - 9 * 60000, 10, NOW, 60],
    ['بعد ١٠ دقائق بالضبط: مفتوح', NOW - 10 * 60000, 10, NOW, null],
    ['بعد ساعة: مفتوح', NOW - 3600000, 10, NOW, null],
    ['مهلةُ صفر تُعطّل الحارس (قيمةٌ صالحة)', NOW, 0, NOW, null],
    ['مهلةٌ سالبة لا تحجب', NOW, -5, NOW, null],
    ['مهلةٌ غير رقمية لا تحجب', NOW, NaN, NOW, null],
    // 🪤 فشلٌ **مفتوح** مقصود وموثَّق: `booked_at` غائبة ⇒ لا حجب. وهي لا
    //    تغيب فعلاً (قِيس على جدّة: ٠ من ١١٢)، والقاعدة تُعامل الغيابَ
    //    بـ`COALESCE(...,0)` بنفس النتيجة — فالطرفان متّفقان لا منحرفان.
    ['غيابُ booked_at: لا حجب (مطابقٌ للقاعدة)', null, 10, NOW, null],
];
for (const [name, bookedAt, mins, now, wantSec] of CASES) {
    const r = selfCloseLeft(bookedAt, mins, now);
    const got = r ? r.seconds : null;
    check(name, got === wantSec, `المتوقّع ${wantSec} والناتج ${got}`);
}

// ── ٢) الموقعُ والبوتان يحسبان **نفسَ** الشيء ──────────────────────────────
// 🪤 نسختان للحساب ضرورةٌ لا ترف (لا يستورد البوت TypeScript) — والخطرُ
//    انحرافُهما. ولذلك تُقارن ثانيةً بثانية على مدى ساعة.
(async () => {
    let drift = null;
    for (let s = 1; s <= 3600; s += 7) {
        const bookedAt = NOW - s * 1000;
        const web = selfCloseLeft(bookedAt, 10, NOW);
        const bot = await HOLDS.selfCloseLeft(bookedAt, 'ar', NOW);
        const a = web ? web.seconds : null;
        const b = bot ? bot.seconds : null;
        if (a !== b) { drift = `عند ${s}ث: الموقع ${a} والبوت ${b}`; break; }
    }
    check('الموقعُ والبوتُ يتّفقان ثانيةً بثانية على مدى ساعة', drift === null, drift);

    // والصياغةُ كذلك — «بعد ٠ دقائق» ثم رفضٌ = شاشةٌ تكذب.
    const near = await HOLDS.selfCloseLeft(NOW - (10 * 60000 - 1000), 'ar', NOW);
    check('ثانيةٌ متبقّية تُصاغ «دقيقة واحدة» لا «٠»',
        !!near && near.label === 'دقيقة واحدة', near && near.label);
    const webNear = selfCloseLeft(NOW - (10 * 60000 - 1000), 10, NOW);
    check('ونسخةُ الموقع تقول الشيء نفسه',
        !!webNear && webNear.label(true) === 'دقيقة واحدة', webNear && webNear.label(true));

    // ── ٣) البنية: لا رقمَ مكتوبٌ نصّاً، والمصدرُ واحد ────────────────────
    const notice = strip(R('src/components/SelfCloseNotice.tsx'));
    check('بوّابةُ الواجهة تقرأ الرقمَ من الإعدادات لا من ثابت',
        /platformSettings\.bookingHolds\.selfCloseMinutes/.test(notice));

    const ps = strip(R('src/context/platformSettings.ts'));
    check('قارئُ الإعدادات يقرأ self_close_minutes', /self_close_minutes/.test(ps));
    check('ومفتاحُ booking_holds في قائمة الجلب (فخّ v14.92)',
        /PLATFORM_SETTING_KEYS[\s\S]*'booking_holds'/.test(ps));

    for (const f of ['src/pages/Bookings.tsx', 'src/components/seller/OrderCloseActions.tsx']) {
        check(`${f.split('/').pop()} يلفّ زرَّه بالبوّابة`,
            /SelfCloseNotice/.test(strip(R(f))));
    }
    check('اختصارُ التاجر ينادي merchant_handover_booking لا complete_booking',
        /merchantHandover/.test(strip(R('src/components/seller/OrderCloseActions.tsx')))
        && /merchant_handover_booking/.test(strip(R('src/repositories/bookingRepository.ts'))));

    // ومسارُ الكود يبقى فورياً — لو لُفّ هو أيضاً أُوذي عميلٌ واقفٌ عند الصندوق.
    const oca = strip(R('src/components/seller/OrderCloseActions.tsx'));
    const codeIdx = oca.indexOf('closeByCode');
    const gateIdx = oca.indexOf('SelfCloseNotice', oca.indexOf('return ('));
    check('ومسارُ الكود خارجَ البوّابة (فوريٌّ بلا مهلة)',
        codeIdx > 0 && gateIdx > 0 && oca.indexOf('closeByCode', oca.indexOf('return (')) < gateIdx);

    // ── ٤) البوتان معاً — لا ميزةٌ في قناةٍ دون أخرى (قاعدةُ v14.71) ──────
    for (const f of ['server/bot.js', 'server/flows/whatsapp.js']) {
        const src = strip(R(f));
        check(`${f.split('/').pop()}: يحجب الزرَّ قبل المهلة`, /selfCloseLeft/.test(src));
        check(`${f.split('/').pop()}: مفرداتُ الرفض من المصدر المشترك`, /receiptErrKey/.test(src));
    }
    const i18n = JSON.parse(R('server/lib/i18n-data.json'));
    for (const k of ['b_confirm_receipt_too_soon', 'b_confirm_receipt_soon']) {
        check(`سلسلةُ ${k} بالعربية والإنجليزية ومعها {0}`,
            !!i18n[k] && !!i18n[k].ar && !!i18n[k].en
            && i18n[k].ar.includes('{0}') && i18n[k].en.includes('{0}'),
            JSON.stringify(i18n[k] || null));
    }
    check('والرمزُ too_soon مربوطٌ برسالته', HOLDS.receiptErrKey('too_soon') === 'b_confirm_receipt_too_soon');
    check('ورمزٌ مجهولٌ يسقط إلى رسالةٍ عامّة لا إلى صمت',
        HOLDS.receiptErrKey('مجهول') === 'b_confirm_receipt_failed');

    // ── ٥) القاعدةُ هي الحَكَم: الهجرةُ تحمل الحارسَ لا الواجهةُ وحدها ────
    const mig = R('supabase/JEDDAH_v15_42_self_close_delay.sql')
        .replace(/^--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');
    for (const [name, re] of [
        ['buyer_confirm_receipt', /buyer_confirm_receipt[\s\S]*?taki_self_close_minutes/],
        ['bot_buyer_confirm_receipt', /bot_buyer_confirm_receipt[\s\S]*?too_soon/],
        ['merchant_handover_booking', /merchant_handover_booking[\s\S]*?taki_self_close_minutes/],
    ]) check(`الهجرة: ${name} يحمل المهلة`, re.test(mig));
    check('الهجرة: ثُلمةُ المشتري في complete_booking مسدودة',
        /complete_booking[\s\S]*?AND caller = store_id/.test(mig)
        && !/caller = store_id OR caller = user_id/.test(mig));
    check('الهجرة: تحقّقٌ **سلوكيّ** لا نصّيٌّ وحده',
        /DO \$behave\$/.test(mig) && /buyer_confirm_receipt\(v_bc\)/.test(mig));

    console.log(`${fail ? '❌' : '✅'} مهلةُ الختم بلا كود: ${pass + fail} فحصاً — الحسابُ تنفيذاً والبنيةُ نصّاً`);
    process.exit(fail ? 1 : 0);
})();
