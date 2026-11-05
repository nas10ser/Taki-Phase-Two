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


// 🔴 مستخرجُ جسمِ دالّةٍ بعينها من نصّ الهجرة.
//    كشف الفحصُ المستقلّ أن أنماطاً مثل `/fn[\s\S]*?token/` **تمتدّ عبر
//    الملفّ كلِّه**: يكفي أن يرد الرمزُ في أيّ موضعٍ لاحق — ولو في دالّةٍ
//    أخرى أو في كتلة التحقّق — فيمرّ الفحصُ وجسمُ الدالّة فارغٌ تماماً.
//    (قِيس: حُذفت مهلةُ الختم كلُّها من الثلاث ومرّ الحارسُ أخضر.)
const fnBody = (sql, name) => {
    const re = new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\s*\\(', 'g');
    const m = re.exec(sql);
    if (!m) return '';
    const rest = sql.slice(m.index);
    // جسمُ الدالّة ينتهي عند `$function$;` أو `$$;` — أوّلُ إغلاقٍ بعدها.
    const end = rest.search(/\$function\$\s*;|\$\$\s*;/);
    return end > 0 ? rest.slice(0, end) : rest;
};

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

// ── ١) الحسابُ يُقاس تنفيذاً ───────────────────────────────────────────────
// 🪤 v15.44 نقلت المرساةَ إلى **تأكيد التاجر** ومعها فتحةٌ احتياطيّة؛ وتفصيلُها
//    في `check-ack-anchor.js`. وهنا ما بقي خاصّاً بالمهلة نفسِها.
const holdSrc = R('src/utils/bookingHold.ts');
const ms = holdSrc.match(/export const selfCloseState = \([\s\S]*?\n\): SelfCloseState => \{([\s\S]*?)\n\};/);
const mo = holdSrc.match(/export const selfCloseOpensAt = \(b: SelfCloseInput, minutes: number\): number => \{([\s\S]*?)\n\};/);
const mi = holdSrc.match(/export const isAcknowledged = \(b: SelfCloseInput\): boolean =>\n([\s\S]*?);\n/);
if (!ms || !mo || !mi) { console.log('❌ لم يُعثر على دوالّ الحالة في bookingHold.ts'); process.exit(1); }
const { arCount, enCount } = require('../shared/arPlural');
const minutesLabelGen = (n, isRTL) => (isRTL ? arCount(n, 'minutes', true) : enCount(n, 'minute', 'minutes'));
let selfCloseState;
try {
    // eslint-disable-next-line no-eval
    selfCloseState = eval(`(minutesLabelGen) => {
        const isAcknowledged = (b) => ${mi[1].trim()};
        const selfCloseOpensAt = (b, minutes) => {${mo[1]}
        };
        return (b, minutes, nowMs) => {${ms[1].replace(/\(isRTL: boolean\)/g, '(isRTL)')}
        };
    }`)(minutesLabelGen);
} catch (e) {
    console.log('❌ تعذّر تنفيذ selfCloseState المستخرجة: ' + e.message);
    process.exit(1);
}

const NOW = 1_700_000_000_000;
// 🪤 الحجزُ يسبق التأكيد دائماً — وإلّا ردّت الأرضيّةُ حالةً مستحيلة فبدا
//    الكودُ مكسوراً وهو سليم.
const ACK = (at) => ({ status: 'acknowledged', acknowledgedAt: at, bookedAt: at - 60000, expiryTime: NOW + 7200000 });
const CASES = [
    ['لحظةَ التأكيد: محجوب', ACK(NOW), 10, 600],
    ['بعد ٩ دقائق: محجوبٌ بدقيقة', ACK(NOW - 9 * 60000), 10, 60],
    ['بعد ١٠ دقائق بالضبط: مفتوح', ACK(NOW - 10 * 60000), 10, null],
    ['بعد ساعة: مفتوح', ACK(NOW - 3600000), 10, null],
    ['مهلةُ صفر تُعطّل الحارس (قيمةٌ صالحة)', ACK(NOW), 0, null],
    ['مهلةٌ سالبة لا تحجب', ACK(NOW), -5, null],
    ['مهلةٌ غير رقمية لا تحجب', ACK(NOW), NaN, null],
];
for (const [name, b, mins, wantSec] of CASES) {
    const r = selfCloseState(b, mins, NOW);
    check(name, (r ? r.seconds : null) === wantSec, `المتوقّع ${wantSec} والناتج ${r && r.seconds}`);
}
check('طلبٌ لم يؤكّده التاجر: محجوبٌ بسببٍ آخر، لا للأبد',
    (() => { const r = selfCloseState({ status: 'pending', bookedAt: NOW, expiryTime: NOW + 7200000 }, 10, NOW);
             return !!r && r.acknowledged === false && r.seconds === 6600; })());

// ── ٢) الموقعُ والبوتان يحسبان **نفسَ** الشيء ──────────────────────────────
(async () => {
    let drift = null;
    for (let s = 1; s <= 3600; s += 7) {
        const ackAt = NOW - s * 1000;
        const web = selfCloseState(ACK(ackAt), 10, NOW);
        const bot = await HOLDS.selfCloseState({ status: 'acknowledged', ack_at_ms: ackAt, booked_at_ms: ackAt - 60000, expiry_time: NOW + 7200000 }, 'ar', NOW);
        const a = web ? web.seconds : null;
        const b = bot ? bot.seconds : null;
        if (a !== b) { drift = `عند ${s}ث: الموقع ${a} والبوت ${b}`; break; }
    }
    check('الموقعُ والبوتُ يتّفقان ثانيةً بثانية على مدى ساعة', drift === null, drift);

    const near = await HOLDS.selfCloseState({ status: 'acknowledged', ack_at_ms: NOW - (10 * 60000 - 1000), booked_at_ms: NOW - 10 * 60000, expiry_time: NOW + 7200000 }, 'ar', NOW);
    check('ثانيةٌ متبقّية تُصاغ «دقيقة واحدة» لا «٠»', !!near && near.label === 'دقيقة واحدة', near && near.label);
    const webNear = selfCloseState(ACK(NOW - (10 * 60000 - 1000)), 10, NOW);
    check('ونسخةُ الموقع تقول الشيء نفسه', !!webNear && webNear.label(true) === 'دقيقة واحدة', webNear && webNear.label(true));

// ── ٣) البنية: لا رقمَ مكتوبٌ نصّاً، والمصدرُ واحد ────────────────────
    const notice = strip(R('src/components/SelfCloseNotice.tsx'));
    check('بوّابةُ الواجهة تقرأ الرقمَ من الإعدادات لا من ثابت',
        /platformSettings\.bookingHolds\.selfCloseMinutes/.test(notice));

    const ps = strip(R('src/context/platformSettings.ts'));
    check('قارئُ الإعدادات يقرأ self_close_minutes', /self_close_minutes/.test(ps));
    check('ومفتاحُ booking_holds في قائمة الجلب (فخّ v14.92)',
        /PLATFORM_SETTING_KEYS[\s\S]*'booking_holds'/.test(ps));

    // 🔴 v15.49 — كان هذا `/SelfCloseNotice/.test(file)`: **ورودُ الاسم** وحده.
    //    فاستيرادٌ غير مستعمل، أو بوّابةٌ **شقيقةٌ** للزرّ بدل غلافٍ له، كانا
    //    يمرّان أخضرَين والزرُّ مكشوف. فيُقاس أن الزرَّ **ابنٌ** للبوّابة:
    //    وسمُ فتحٍ ووسمُ إغلاقٍ وبينهما `<button`.
    for (const f of ['src/pages/Bookings.tsx', 'src/components/seller/OrderCloseActions.tsx']) {
        const src = strip(R(f));
        const open = src.indexOf('<SelfCloseNotice');
        const close = src.indexOf('</SelfCloseNotice>', open + 1);
        check(`${f.split('/').pop()} يلفّ زرَّه بالبوّابة (ابنٌ لا شقيق)`,
            open > 0 && close > open && src.slice(open, close).includes('<button'),
            open < 0 ? 'لا وسمَ بوّابةٍ إطلاقاً'
                : close < 0 ? 'وسمُ فتحٍ بلا إغلاق — الزرُّ ليس داخلها'
                : 'لا زرَّ بين وسمَي البوّابة');
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
    // 🔴 v15.49 — وكان فحصُ القناتين `/selfCloseState/.test(src)`: اسمٌ يَرِد
    //    في أيّ موضعٍ من الملفّ يُرضيه، ولو كان في دالّةٍ أخرى لا تحجب شيئاً.
    //    فيُقاس **موضعُ القرار**: زرُّ «استلمت طلبي» يُدفع في فرع `else` تابعٍ
    //    لنتيجةِ البوّابة — فلو خرج منها صار الزرُّ بلا مهلة.
    for (const f of ['server/bot.js', 'server/flows/whatsapp.js']) {
        const src = strip(R(f));
        const push = src.indexOf("'b_confirm_receipt'");
        const win = push > 0 ? src.slice(Math.max(0, push - 700), push) : '';
        const gate = win.lastIndexOf('selfCloseState');
        check(`${f.split('/').pop()}: الزرُّ يُدفع في فرعِ البوّابة لا بجانبها`,
            push > 0 && gate >= 0 && /\bif \(rcvW\)/.test(win.slice(gate))
            && /\belse\b/.test(win.slice(gate)),
            push < 0 ? 'لم يُعثر على موضع دفع الزرّ'
                : gate < 0 ? 'الزرُّ يُدفع بلا نداءِ بوّابةٍ قبله — بلا مهلة'
                : 'نداءُ البوّابة موجودٌ لكنّ الزرَّ خارج فرعِها');
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
    // ويُفحص **جسمُ كلّ دالّةٍ وحده** لا الملفُّ كلُّه.
    for (const [name, token] of [
        ['buyer_confirm_receipt', 'taki_self_close_minutes'],
        ['bot_buyer_confirm_receipt', 'too_soon'],
        ['merchant_handover_booking', 'taki_self_close_minutes'],
    ]) {
        const body = fnBody(mig, name);
        check(`الهجرة: ${name} يحمل المهلة`,
            body.length > 0 && body.includes(token),
            body.length === 0 ? 'لم يُعثر على جسم الدالّة' : 'الجسمُ موجودٌ بلا الرمز');
    }
    check('الهجرة: ثُلمةُ المشتري في complete_booking مسدودة',
        /complete_booking[\s\S]*?AND caller = store_id/.test(mig)
        && !/caller = store_id OR caller = user_id/.test(mig));
    check('الهجرة: تحقّقٌ **سلوكيّ** لا نصّيٌّ وحده',
        /DO \$behave\$/.test(mig) && /buyer_confirm_receipt\(v_bc\)/.test(mig));

    console.log(`${fail ? '❌' : '✅'} مهلةُ الختم بلا كود: ${pass + fail} فحصاً — الحسابُ تنفيذاً والبنيةُ نصّاً`);
    process.exit(fail ? 1 : 0);
})();
