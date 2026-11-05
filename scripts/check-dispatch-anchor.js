// حارسُ «انطلاقُ المندوب لا يُنسى» (v15.49) — node scripts/check-dispatch-anchor.js
//
// ── ما يحرسه ───────────────────────────────────────────────────────────────
// `delivery_tracks.status` كان يحمل معنيين: «أين المندوبُ الآن» و«هل انطلق
// أصلاً». والمنظّفُ `taki_expire_delivery_tracks` يكتبه `cancelled` بعد ساعةٍ
// من صمت الهاتف — مسحُ بثٍّ بائت لا رجوعٌ عن الانطلاق. وستّةُ قُرّاءٍ كانوا
// يقرؤونه رجوعاً، فمشترٍ استلم بضاعته يفقد زرَّ التأكيد ثمّ يُلغى طلبُه
// تلقائياً وتعود بضاعتُه للبيع.
//
// العقدُ المحروس: المعنى الدائم في `dispatched_at` (يطبعه مشغّلٌ ولا يُمحى)،
// وكلُّ قارئٍ يسأل الحقيقةَ لا يُطابق قائمةً.
//
// 🔴 ودروسُ حرّاسٍ سابقة مطبَّقةٌ هنا بعينها:
//    · التعليقُ يُجرَّد قبل أي فحص — حارسٌ أمسك تعليقَه هو أربع مرّات.
//    · النمطُ يُقاس على **جسم الدالّة** لا على الملفّ: نمطٌ يمتدّ عبر الملفّ
//      يُرضيه ورودُ الرمز في كتلة التحقّق نفسها (قِيس: حُذفت المهلةُ كلّها
//      من ثلاث دوالّ ومرّ الحارسُ أخضر).
//    · و«الاسمُ موجود» لا يكفي: تُقاس **مواضعُ القرار** — السطرُ الذي يُظهر
//      الزرَّ أو يُخفيه — لا مجرّد ورودِ الحقل في الملفّ.
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const stripSql = (s) => s.replace(/^[ \t]*--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');
const stripJs = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

/** جسمُ دالّةٍ واحدة من ملفّ هجرة — لا الملفّ كلّه (درس v15.48). */
const fnBody = (sql, name) => {
    const re = new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\s*\\(', 'g');
    const m = re.exec(sql);
    if (!m) return '';
    const rest = sql.slice(m.index);
    const end = rest.search(/\$function\$\s*;|\$\$\s*;/);
    return end > 0 ? rest.slice(0, end) : rest;
};

const MIG = 'supabase/JEDDAH_v15_49_dispatch_anchor.sql';
const sql = stripSql(R(MIG));

// ── ١) المعنى الدائم موجودٌ ومحميّ ─────────────────────────────────────────
check('عمودُ dispatched_at في الهجرة',
    /ALTER TABLE public\.delivery_tracks ADD COLUMN IF NOT EXISTS dispatched_at/.test(sql));

const stamp = fnBody(sql, 'tr_stamp_dispatch');
check('المشغّلُ يطبع عند «انطلق» و«وصل» و«سُلّم» جميعاً',
    ["'on_the_way'", "'arrived'", "'delivered'"].every(s => stamp.includes(s))
    && /NEW\.dispatched_at\s*:=\s*COALESCE\(NEW\.dispatched_at,\s*now\(\)\)/.test(stamp),
    'طبعٌ عند on_the_way وحدها يُنسي انطلاقَ تاجرٍ ضغط «وصل» مباشرةً');
check('ولا يملك أحدٌ محوَ المرساة',
    /TG_OP\s*=\s*'UPDATE'\s*AND\s*OLD\.dispatched_at IS NOT NULL/.test(stamp)
    && /NEW\.dispatched_at\s*:=\s*OLD\.dispatched_at/.test(stamp));
check('والمشغّلُ مربوطٌ قبل الكتابة (BEFORE)',
    /CREATE TRIGGER tr_bu_stamp_dispatch\s+BEFORE INSERT OR UPDATE ON public\.delivery_tracks/.test(sql),
    'AFTER لا يستطيع ردَّ محوٍ وقع');

// ── ٢) الحقيقتان تقرآن المعنى الدائم لا الحالة اللحظيّة ────────────────────
for (const fn of ['taki_delivery_dispatched', 'taki_delivery_hold_stopped']) {
    const b = fnBody(sql, fn);
    check(`${fn} تقرأ dispatched_at`, b.includes('t.dispatched_at IS NOT NULL'),
        'بلا هذا الشرط تعود الدالّةُ إلى مطابقة الحالة — وهو العيبُ بعينه');
}
check('و«قيد التجهيز» في «توقّف العدّاد» وحدها لا في «انطلق»',
    !fnBody(sql, 'taki_delivery_dispatched').includes("'preparing'")
    && fnBody(sql, 'taki_delivery_hold_stopped').includes("'preparing'"),
    'عدُّ التجهيزِ انطلاقاً يُعطي الزرَّ قبل أن تغادر البضاعة');

// ── ٣) القرّاءُ الستّة — كلٌّ بجسمه هو ─────────────────────────────────────
const READERS = {
    buyer_confirm_receipt: 'taki_delivery_dispatched',
    bot_buyer_confirm_receipt: 'taki_delivery_dispatched',
    taki_autocancel_blocked: 'taki_delivery_hold_stopped',
    bot_get_my_bookings: 'taki_delivery_dispatched',
    delivery_track_get: 'dispatched_at IS NOT NULL',
    bot_delivery_track_get: 'dispatched_at IS NOT NULL',
};
for (const [fn, needle] of Object.entries(READERS)) {
    const b = fnBody(sql, fn);
    check(`${fn} تسأل الحقيقة`, b.length > 0 && b.includes(needle),
        b.length ? `لم يُعثر على «${needle}» في جسمها` : 'الدالّةُ غائبةٌ عن الهجرة');
}
// 🪤 ومطابقةُ الحالة لا يجوز أن تبقى **قراراً** في جسم القارئ.
for (const fn of ['buyer_confirm_receipt', 'bot_buyer_confirm_receipt']) {
    const b = fnBody(sql, fn);
    check(`${fn} لا تُطابق قائمةَ حالاتٍ لتقرّر الانطلاق`,
        !/NOT IN \('on_the_way','arrived','delivered'\)/.test(b));
}
check('وشبكةُ الأمان لها حدٌّ أدنى بعد مهلة الطلب نفسِه',
    /COALESCE\(p_expiry_time, 0\) \+ 3600000/.test(fnBody(sql, 'taki_autocancel_blocked')),
    'بلا الحدّ: مهلةٌ ٧٢ وشبكةٌ ٧٢ ⇒ حمايةٌ صفر، ويُلغى طلبٌ مندوبه في الطريق');

// ── ٤) والتحقّقُ السلوكيّ في الهجرة يبلغ موضعَ العيب فعلاً ────────────────
const behave = sql.slice(sql.indexOf('DO $behave$'));
check('التحقّقُ يُشغّل المنظّفَ الحقيقيّ',
    behave.includes('PERFORM public.taki_expire_delivery_tracks()'),
    'تحقّقٌ يكتب cancelled بيده يختبر نسخةً من العيب لا العيب');
check('ويُجرّب محوَ المرساة صراحةً',
    /UPDATE public\.delivery_tracks SET dispatched_at = NULL/.test(behave));
check('ويختبر «وصل» لا «انطلق» (الحالةُ الأسوأ)',
    /VALUES \(v_bc, v_sid, v_usr, 'arrived'\)/.test(behave),
    "'on_the_way' يطبع started_at فيُخفي العيب");

// ── ٥) مواضعُ القرار في العملاء الثلاثة ───────────────────────────────────
// الزرُّ يُعطى أو يُمنع في سطرٍ واحدٍ في كلّ قناة — وهو ما يُقاس، لا الملفّ.
const gate = (file, re, label) => {
    const src = stripJs(R(file));
    const line = src.split('\n').find(l => re.test(l));
    return { src, line, label };
};
const WEB = gate('src/pages/Bookings.tsx', /SelfCloseNotice|\?\.dispatched\) && \(/, 'الموقع');
const webSrc = WEB.src;
const webGate = webSrc.split('\n').find(l => l.includes("booking.fulfillment !== 'delivery'"));
check('الموقع: بوّابةُ الزرّ تقرأ dispatched',
    !!webGate && /\?\.dispatched/.test(webSrc.slice(webSrc.indexOf(webGate), webSrc.indexOf(webGate) + 240)),
    'بوّابةُ الزرّ ما زالت تُطابق DELIVERY_STARTED');
check('الموقع: holdRunning يقرأ holdStopped لا قائمةً',
    /const holdRunning = \(b: any, snap[\s\S]{0,320}?snap\?\.holdStopped/.test(webSrc)
    && !/const holdRunning[\s\S]{0,320}?HOLD_STOPPED_STAGES\.includes/.test(webSrc));

const bot = stripJs(R('server/bot.js'));
check('تيليجرام: بوّابةُ الزرّ تقرأ dlvDispatched(b)',
    /fulfillment\|\|'pickup'\)!=='delivery' \|\| dlvDispatched\(b\)\)/.test(bot));
check('تيليجرام: dlv_dispatched هي الأصل والقائمةُ ارتداد',
    /dlv_dispatched === 'boolean'\s*\?\s*b\.dlv_dispatched/.test(bot));
check('تيليجرام: holdRunning يقرأ hold_running',
    /function holdRunning\(b\)\{[\s\S]{0,260}?typeof b\.hold_running === 'boolean'\) return b\.hold_running/.test(bot));

const wa = stripJs(R('server/flows/whatsapp.js'));
check('واتساب: بوّابةُ الزرّ تقرأ waDispatched(b)',
    /fulfillment !== 'delivery' \|\| waDispatched\(b\)\)/.test(wa));
check('واتساب: dlv_dispatched هي الأصل والقائمةُ ارتداد',
    /dlv_dispatched === 'boolean'\s*\?\s*b\.dlv_dispatched/.test(wa));
check('واتساب: waHoldRunning يقرأ hold_running',
    /function waHoldRunning\(b\) \{[\s\S]{0,280}?typeof b\.hold_running === 'boolean'\) return b\.hold_running/.test(wa));

// ── ٦) وما تقوله الشاشتان عن مسارٍ أُلغي بثُّه ─────────────────────────────
// 🪤 الإصلاحُ بلا هذا نصفُ إصلاح: الزرُّ يعود والشاشةُ تقول «⛔ أُلغي التوصيل»
//    لمشترٍ يحمل بضاعته، والتاجرُ يفقد «تم التسليم» و«بدء التوصيل» معاً.
const map = stripJs(R('src/components/DeliveryTrackMap.tsx'));
check('خريطةُ المشتري تفرّق بين الإلغاء وانقطاع البثّ',
    /const trackingStopped = status === 'cancelled' && data\?\.dispatched === true/.test(map)
    && map.indexOf('if (trackingStopped)') > 0
    && map.indexOf('if (trackingStopped)') < map.indexOf("if (status === 'cancelled')"),
    'فرعُ انقطاعِ البثّ غائبٌ أو بعد فرعِ الإلغاء فلا يُصاب أبداً');

const card = stripJs(R('src/components/seller/DeliveryTrackerCard.tsx'));
check('بطاقةُ التاجر لا تُحبسه عند انقطاع البثّ',
    /const trackingStopped = status === 'cancelled' && track\?\.dispatched === true/.test(card)
    && /const finished = \(status === 'delivered' \|\| status === 'cancelled'\) && !trackingStopped/.test(card),
    '`finished` يسحب «تم التسليم» و«بدء التوصيل» فيبقى التاجرُ بلا مخرج');
check('وكلتاهما تقرأ dispatched من الردّ',
    /dispatched\?: boolean/.test(map) && /dispatched: d\.dispatched === true/.test(card));

console.log(fail === 0
    ? `\n✅ مرساةُ الانطلاق محروسة (${pass} فحصاً)`
    : `\n❌ ${fail} فحصاً سقط من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
