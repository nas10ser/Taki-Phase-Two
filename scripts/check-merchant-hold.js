// حارسُ «مهلة الحجز بيد التاجر» (v15.43) — node scripts/check-merchant-hold.js
//
// ── العيبُ الذي يحرسه ──────────────────────────────────────────────────────
// صارت المهلةُ لكلّ متجرٍ مهلتَه (أمرُ ناصر)، ورقمُ المنصّة افتراضاً لمن لم
// يحدّد. والخطرُ **ليس** في القاعدة — تلك مقيسةٌ سلوكياً في الهجرة — بل في
// أن تبقى شاشةٌ أو بوتٌ أو وثيقةٌ تقول رقمَ المنصّة قطعاً:
//   • صفحةُ العرض لو قرأت `platformSettings` ⇒ تَعِد بساعتين وتُطبَّق خمس.
//   • البوتُ لو نادى `HOLDS.get()` ⇒ وعدٌ مخالفٌ في قناةٍ لا يراها أحدٌ منّا.
//   • الوثائقُ الستّ لو بقيت قاطعة ⇒ **وعدٌ قانونيٌّ لا كودَ له** (درس v14.82:
//     وثيقةٌ تَعِد بما لا يُنفَّذ أسوأ من وثيقةٍ لا تَعِد).
//
// 🪤 ويُجرَّد التعليقُ قبل الفحص: هذا الملفُّ نفسُه يحوي `HOLDS.get()`
//    و`platformSettings`.
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');
const stripSql = (src) => src.replace(/^--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');


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

// ── ١) «فارغ» ≠ «صفر»: الحالةُ الثالثة تُنفَّذ تنفيذاً ─────────────────────
// 🪤 درسُ v15.33 حرفياً: خلطُ الفراغ بالصفر قلب معنى الحقل. وهنا الفراغ
//    «اتبع المنصّة» والصفرُ **مرفوض** (الأرضيّة ربعُ ساعة).
const cardSrc = R('src/components/seller/HoldHoursCard.tsx');
const pm = cardSrc.match(/const parseHours = \(raw: string\): number \| null \| undefined => \{([\s\S]*?)\n\};/);
if (!pm) { console.log('❌ لم يُعثر على parseHours في HoldHoursCard'); process.exit(1); }
// eslint-disable-next-line no-eval
const parseHours = eval(`(raw) => {${pm[1].replace(/: string/g, '')}\n}`);
for (const [name, input, want] of [
    ['حقلٌ فارغ = «اتبع المنصّة» لا صفر', '', null],
    ['مسافاتٌ فقط = «اتبع المنصّة»', '   ', null],
    ['«2» رقم', '2', 2],
    ['«0.5» كسرٌ مقبولٌ نصّاً (القاعدة ترفضه إن قلّ عن الأرضيّة)', '0.5', 0.5],
    ['«٣» أرقامٌ عربية تُقرأ', '٣', 3],
    ['«٢٤» عربيّتان', '٢٤', 24],
    ['«abc» غير صالح ⇒ undefined لا null', 'abc', undefined],
    ['«0» صفرٌ صريح يبقى صفراً (ولا يصير فراغاً)', '0', 0],
]) {
    const got = parseHours(input);
    check(name, got === want || (Number.isNaN(got) && Number.isNaN(want)), `المتوقّع ${want} والناتج ${got}`);
}

// ── ٢) الواجهةُ لا تحسب الارتداد — تقرؤه محسوباً ───────────────────────────
const hook = strip(R('src/hooks/useStoreHold.ts'));
check('الخطّافُ يقرأ المهلةَ الفعّالة من store_policies',
    /storePolicies\(/.test(hook) && /holdPickupHours/.test(hook));
check('ولا يُعيد بناء سلسلةِ الاستثناء في الواجهة',
    !/holdPickupCustom/.test(hook) && !/holdDeliveryCustom/.test(hook));
check('ولا يُخزّن فشلاً عابراً فيُجمّد رقماً خاطئاً',
    /r\.ok &&/.test(hook));

const dd = strip(R('src/pages/DealDetails.tsx'));
check('صفحةُ العرض تسأل عن مهلة متجرها', /useStoreHold\(/.test(dd));
check('ولم يبقَ فيها قارئُ مهلةِ المنصّة',
    !/platformSettings\.bookingHolds\.(pickup|delivery)Hours/.test(dd),
    'ما زالت تقرأ رقمَ المنصّة مباشرةً — فتَعِد بما لا يُطبَّق');

// والخامُ لشاشةِ التاجر وحدها
check('الخامُ (custom) في بطاقة التاجر وحدها',
    /holdPickupCustom/.test(strip(cardSrc)));

// ── ٣) البوتان معاً — ولا قناةَ تَعِد برقمٍ آخر ────────────────────────────
for (const f of ['server/bot.js', 'server/flows/whatsapp.js']) {
    const src = strip(R(f));
    const name = f.split('/').pop();
    check(`${name}: شاشةُ التأكيد تسأل عن مهلة المتجر`, /HOLDS\.forStore\(/.test(src));
    check(`${name}: ولم يبقَ HOLDS.get() في شاشة التأكيد`,
        !/const HH = await HOLDS\.get\(\)/.test(src),
        'ما زالت تقرأ رقمَ المنصّة — وعدٌ مخالفٌ في قناةٍ لا نراها');
}
const holds = require('../server/lib/holds');
check('lib/holds يُصدّر forStore', typeof holds.forStore === 'function');

// ── ٤) الوثائقُ لا تَعِد بما لا ينفّذه الكود ───────────────────────────────
// 🪤 الشرطُ بنيويّ لا كلماتٌ مفتاحية: كلُّ موضعٍ يرسم `<HoldHours>` يجب أن
//    يقول في جملته إنّ المتجرَ هو من يحدّد — وإلّا فهو وعدٌ قاطعٌ كاذب.
const LEGAL = ['src/pages/legal/Terms.tsx', 'src/pages/legal/Refund.tsx', 'src/pages/legal/FAQ.tsx'];
for (const f of LEGAL) {
    const src = R(f);
    const name = f.split('/').pop();
    const spots = src.split('\n').filter(l => l.includes('<HoldHours'));
    check(`${name}: فيها جملٌ تذكر المهلة`, spots.length >= 2, `العدد ${spots.length}`);
    const ar = spots.filter(l => /يحدّدها المتجر|يحدّده المتجر|المهلة يحدّدها/.test(l)).length;
    const en = spots.filter(l => /set by the store/.test(l)).length;
    check(`${name}: كلُّ جملةٍ تقول إنّ المتجر يحدّدها (عربي ${ar} · إنجليزي ${en})`,
        ar + en === spots.length, `${ar + en} من ${spots.length}`);
}
const lv = R('src/data/legalVersion.ts');
check('إصدارُ الوثائق تغيّر (أي تعديلٍ قانونيّ يُغيّره)',
    !/LEGAL_VERSION = '2026-09-27'/.test(lv) && /LEGAL_VERSION = '20\d\d-\d\d-\d\d'/.test(lv));

// ── ٥) القاعدةُ هي الحَكَم ─────────────────────────────────────────────────
const mig = stripSql(R('supabase/JEDDAH_v15_43_merchant_booking_hold.sql'));
check('الهجرة: المُحكّم بمعاملين (نوعٌ ومتجر)',
    /taki_booking_hold_hours\(p_fulfillment text, p_store_id text\)/.test(mig));
// 🪤 وفي جسم المشغّل وحده: كتلةُ التحقّق في الهجرة تبحث عن نفس الرمز،
//    فكانت تُبقيه حيّاً في النصّ ولو سقط المعاملُ من المشغّل فعلاً.
check('الهجرة: المشغّل يمرّر متجرَ الحجز',
    fnBody(mig, 'tr_ad_set_booking_hold').includes('NEW.store_id'),
    'المعاملُ غائبٌ عن جسم المشغّل — المهلةُ تعود واحدةً للمنصّة');
check('الهجرة: قراءةُ الزائر تُعيد المهلةَ الفعّالة',
    /store_policies[\s\S]*?hold_pickup_hours[\s\S]*?taki_booking_hold_hours/.test(mig));
check('الهجرة: نسخةُ المعامل الواحد باقية (لا يُكسر منادٍ قديم)',
    /to_regprocedure\('public\.taki_booking_hold_hours\(text\)'\) IS NULL/.test(mig));
check('الهجرة: حارسٌ يرفض مشغّلاً غير BEFORE INSERT',
    /NOT LIKE '%BEFORE INSERT ON%'/.test(mig),
    'بلا هذا الحارس قد يتبدّل وعدُ حجزٍ قائم لحظةَ ضبط التاجر');
check('الهجرة: استثناءُ التاجر مقصوصٌ بسقف المنصّة',
    /taki_booking_hold_max\(\)/.test(mig));
check('الهجرة: تحقّقٌ **سلوكيّ** لا نصّيٌّ وحده',
    /DO \$behave\$/.test(mig) && /expiry_time - booked_at/.test(mig));

// ── ٦) بطاقةُ المدير: خمسةُ حقولٍ بوحدتين ──────────────────────────────────
const adm = strip(R('src/components/admin/BookingHoldsCard.tsx'));
for (const k of ['pickup_hours', 'delivery_hours', 'in_progress_hours', 'max_hold_hours', 'self_close_minutes']) {
    check(`بطاقةُ المدير تكتب ${k}`, new RegExp(k).test(adm));
}
// 🪤 الوحدةُ ليست واحدة: «قبل الختم بلا كود» بالدقائق. لو ورثت «ساعة» لضبط
//    المديرُ ١٠ وقصد دقائق فكُتبت ساعات — خطأٌ لا يظهر إلا على طلبٍ حقيقيّ.
check('ولكلّ حقلٍ وحدتُه (دقيقة للختم، ساعة لغيره)',
    /unit: 'min'/.test(adm) && /unit: 'h'/.test(adm) && /'ساعة' : 'دقيقة'/.test(adm));
check('ولا يُرسم حقلٌ قبل وصول قيمته', /AdmSkeleton/.test(adm) && /AdmError/.test(adm));
check('ولم تبقَ البطاقةُ في AdminTools', !/saveHolds/.test(strip(R('src/pages/admin/AdminTools.tsx'))));

console.log(`${fail ? '❌' : '✅'} مهلةُ الحجز بيد التاجر: ${pass + fail} فحصاً — الواجهاتُ والوثائقُ والقاعدة`);
process.exit(fail ? 1 : 0);
