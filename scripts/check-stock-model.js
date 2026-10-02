#!/usr/bin/env node
/**
 * check-stock-model.js — «المخزون الكامل» لا يُدهَس مرّةً أخرى (v15.02/03)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيب الذي يحرسه هذا الملفّ، وقد كان قائماً على الإنتاج:
 *    `SellerDashboard.tsx` يكتب عند **كلّ** حفظ `quantity: effQuantity` —
 *    أي يدهس عدّادَ المتاح برقمٍ من النموذج. فتاجرٌ عنده ٢٦ قطعة و٣ محجوزة
 *    يعدّل صورةً ⇒ يعود المتاح ٢٦ وتُباع الثلاثُ المحجوزة مرّةً ثانية.
 *    ولا خطأ يظهر ولا سجلّ.
 *
 * والنموذج بعد الإصلاح ثلاثُ قطعٍ يجب أن تبقى متماسكة — وكسرُ أيّ واحدةٍ
 * منها يُعيد العيب **صامتاً**، ولذلك يُحرس كلٌّ منها هنا:
 *   ١. الواجهة تُبذَر بالمخزون **الكامل** (`onHand`) لا بالمتاح. ولو بُذرت
 *      بالمتاح لانكمش المخزون بمقدار المحجوز عند كلّ حفظ — وهو العيب نفسه
 *      مقلوباً، وأصعبُ اكتشافاً لأنه تدريجيّ.
 *   ٢. القاعدة تشتقّ المتاح ممّا يكتبه التاجر (`tr_b0_stock_declare`).
 *   ٣. والمشغّل يفرّق بين إعلان التاجر وحجز المشتري بعمق المشغّل، وبين
 *      إعلانٍ واشتقاقٍ محسوبٍ سلفاً براية **تُطفأ**.
 *
 * 🪤 ولا يفترض هذا الحارس git ولا `dist` — يعمل داخل بناء Vercel أيضاً.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fail = (m) => { console.error(`\n❌ البناء متوقّف: حارس نموذج المخزون\n\n   ${m}\n`); process.exit(1); };
const read = (rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
    catch { fail(`«${rel}» غير موجود — وهو ركنٌ في نموذج المخزون.`); }
};

/**
 * 🔴 تُجرَّد تعليقاتُ SQL قبل أيّ فحص — وهذا ليس تجميلاً:
 *    كسرتُ `pg_trigger_depth() > 1` في الكود فمرّ الحارس، لأن العبارة نفسها
 *    مكتوبةٌ في **تعليقٍ** يشرحها فوقها. أي أن الحارس كان يقرأ الشرح لا
 *    المشروح — وهو أسوأ من غيابه، لأنه يُطمئن كذباً.
 *    (والدرسُ الأعمّ: كلُّ كسرةٍ تُتحقَّق من وقوعها قبل قراءة نتيجتها.)
 */
const code = (sql) => sql.replace(/--[^\n]*/g, '');

/**
 * 🔴 ونفسُ الفخّ في JS/TS — وقعتُ فيه مرّتين في يومٍ واحد: كسرتُ شرطَ السقف
 *    في `stockView.js` فمرّ الحارس، لأن `initial_quantity` مكتوبةٌ في الشرح
 *    فوق السطر الذي حذفته. تُجرَّد `//` و`/* *\/` قبل أي فحص.
 */

/**
 * 🔴 تجريدٌ أضيق من `jsCode` لملفّات البيانات — والسببُ مقيس:
 *    `jsCode` يحذف كلّ ما بعد `//` فيمسخ `docUrl: 'https://docs.zid.sa/…'`
 *    إلى `'https:`. وهنا لا نريد إلا إسكاتَ التعليقات: الأسطرُ التي **تبدأ**
 *    بتعليق، وكتلُ `/** … *\/`.
 * 🪤 ولماذا أصلاً: كتبتُ في تعليقٍ أن الخطأ القديم كان `variants: 'stocks'`
 *    فأمسك الحارسُ شرحَه هو وأعلن الخطأ قائماً — للمرّة الثالثة في هذا المشروع.
 */
const declCode = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const jsCode = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 🔴 ولا يُقصّ `//` المسبوقُ بنقطتين: `https://…` ليس تعليقاً. وقد فعلها
    //    هذا المُجرِّد فعلاً — ابتلع رابطَ الخطّاف فاتّهم شاشةً سليمة بأنها
    //    لا تعرضه. مُجرِّدٌ ساذج يصنع إنذاراً كاذباً، وهو أسوأ من غيابه.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── ١) الأنواع تحمل المخزون الكامل ────────────────────────────────────────
const mock = read('src/data/mock.ts');
for (const [needle, why] of [
    ['onHand?: number | null;', 'Deal.onHand غائب — لا مكانَ للمخزون الكامل في نموذج الواجهة.'],
    ['onHand?: number;', 'onHand غائب عن DealVariant/DealLocation — الأصناف والفروع بلا مخزونٍ كامل.'],
    ['variantOnHand?: Record<string, number>;', 'variantOnHand غائب — «صنف×فرع» بلا مخزونٍ كامل.'],
]) if (!mock.includes(needle)) fail(why);

// ── ٢) القراءة تجلب العمود وتُسقطه في النموذج ─────────────────────────────
const repo = read('src/repositories/dealRepository.ts');
if (!/'on_hand'/.test(repo)) {
    fail('`on_hand` ليس في DEAL_SELECT — العمود لن يصل الواجهة أبداً، ولا خطأ يظهر (حقلٌ ناقص لا أكثر).');
}
if (!/onHand:\s*d\.is_unlimited\s*\?\s*null\s*:\s*\(d\.on_hand/.test(repo)) {
    fail('`on_hand` لا يُسقَط في `Deal.onHand` — النموذج سيُبذَر بالمتاح فينكمش المخزون كلّ حفظ.');
}
// 🔴 والكتابة المباشرة على الجدول ممنوعة: صارت تُفسَّر إعلاناً
if (/from\('deals'\)[\s\S]{0,200}\.update\(\s*payload\s*\)/.test(repo)
    && !/merchant_set_stock/.test(repo)) {
    fail('`updateQuantity` تكتب على الجدول مباشرةً بدل `merchant_set_stock` — رقمٌ مطلق من قراءةٍ قديمة يصير «مخزوناً كاملاً».');
}

// ── ٣) نموذج التاجر يُبذَر بالكامل لا بالمتاح ─────────────────────────────
const dash = read('src/pages/SellerDashboard.tsx');
for (const [re, why] of [
    [/setQuantity\([^)]*deal\.onHand\s*\?\?\s*deal\.quantity/, 'الإجمالي يُبذَر من `deal.quantity` (المتاح) — سينكمش المخزون بمقدار المحجوز عند كلّ حفظ.'],
    [/qty:\s*v\.onHand\s*\?\?\s*v\.qty/, 'الأصناف تُبذَر من `qty` (المتاح) — كلُّ حفظٍ يقضم من مخزون الصنف.'],
    [/l\.variantOnHand\s*&&/, 'خلايا «صنف×فرع» تُبذَر من `variantQtys` (المتاح) لا من `variantOnHand`.'],
    [/Number\(l\.onHand\s*\?\?\s*l\.quantity\)/, 'كمّية الفرع تُبذَر من `l.quantity` (المتاح) لا من `l.onHand`.'],
]) if (!re.test(dash)) fail(why);

// ── ٤) والقاعدة: الهجرتان تحملان ما يُشتقّ به ─────────────────────────────
const m02 = code(read('supabase/JEDDAH_v15_02_on_hand.sql'));
for (const [needle, why] of [
    ['FOR UPDATE', 'كاتبُ المخزون بلا قفلٍ للصفّ — نداءان يقرآن نفس المحجوز فيبيعان ما لا يوجد.'],
    ["s->>'g' = '__variant__'", 'حسابُ محجوز الصنف بلا وسم `__variant__` — الخياراتُ الإضافية ستُحسب مخزوناً وتُخصم من صنفٍ لم يُبَع.'],
    ['STALE_OBSERVATION', 'لا حمايةَ من ملاحظةٍ أقدم — رسالةٌ متأخّرة من نظام كاشير ستدهس رقماً أصحّ منها.'],
    ["'pending', 'acknowledged'", 'حالاتُ المحجوز تغيّرت — يجب أن تطابق ما يحجزه `adjust_deal_quantity` بالضبط.'],
]) if (!m02.includes(needle)) fail(why);

const m03 = code(read('supabase/JEDDAH_v15_03_declare_stock.sql'));
for (const [needle, why] of [
    ['pg_trigger_depth() > 1', 'لا تمييزَ بين إعلان التاجر وحجز المشتري — حجزُ مشترٍ سينقّص «المخزون الكامل» نفسه.'],
    ["set_config('taki.stock_derived', '0', true)", 'رايةُ الاشتقاق تُرفع ولا تُطفأ — وهي محلّيةٌ للمعاملة، فتُعطّل المشغّل لكلّ ما يليها.'],
    ['tr_b0_stock_declare', 'المشغّل غائب عن الهجرة — النموذج سيظلّ يدهس المخزون.'],
]) if (!m03.includes(needle)) fail(why);

// ── ٥) البوتان يقرآن المخزون الكامل ــ وهذا ما فات v15.04 ────────────────
// 🔴 v15.02 غيّرت دلالة الرقم، وv15.04 لاحقت الموقع **ولم تُلاحق البوتين**.
//    فبقي التاجر في تيليجرام وواتساب يقرأ المتاح مكتوباً «الكمية الحالية»
//    ويُعيد كتابته، فينكمش مخزونه بمقدار المحجوز عند كل تعديل. قِيس حيّاً.
const stk = jsCode(read('server/lib/stockView.js'));
if (!/Number\(d\.initial_quantity \|\| 0\) > 0/.test(stk)) {
    fail('`isSoldOut` في stockView فقد شرطَ السقف — عرضٌ زمنيّ بلا سقفٍ سيُوسم «نفد» وهو لا ينفد.');
}
if (!/d\.on_hand/.test(stk)) fail('stockView لا يقرأ `on_hand` — فهو يعرض المتاح باسم المخزون.');

for (const [f, ceiling] of [['server/flows/sellerDeals.js', null], ['server/flows/whatsapp.js', 2695]]) {
    const src = jsCode(read(f));
    if (!/require\('\.\.\/lib\/stockView'\)/.test(src)) {
        fail(`«${f}» لا يستورد stockView — سيعرض للتاجر المتاحَ بدل مخزونه الكامل.`);
    }
    if (/is_unlimited \? tr\('(wa_unlimited|w778_qty_unlimited|sd254_unlimited)'\) : (tr\('(wa_pcs|sd254_pieces)'|md\(String)/.test(src)) {
        fail(`«${f}» ما زال يبني سطرَ الكمّية يدوياً من \`d.quantity\` — وهو المتاح لا المخزون.`);
    }
    if (ceiling !== null && src.split('\n').length > ceiling) {
        fail(`«${f}» تجاوز سقفه (${ceiling}) — السقّافة تمنع، والمنطقُ الجديد مكانه server/lib/.`);
    }
}

// والصياغةُ تطلب الكامل صراحةً، لا «المتاح»
const i18n = JSON.parse(read('server/lib/i18n-data.json'));
for (const k of ['stk_full', 'stk_full_held', 'stk_short_held', 'stk_unlimited']) {
    if (!i18n[k]) fail(`مفتاح «${k}» غائب عن i18n-data.json — سطرُ المخزون سيطبع اسم المفتاح.`);
}
// 🪤 ونفس المفتاح يُستعمل في تيليجرام (MarkdownV2) وواتساب (نصّ عاديّ) —
//    فمحرفٌ محجوزٌ واحدٌ غير مهروب يُسقط رسالة تيليجرام كلَّها بصمت.
for (const k of ['stk_full', 'stk_full_held', 'stk_short', 'stk_short_held', 'stk_unlimited']) {
    for (const L of ['ar', 'en']) {
        const v = String(i18n[k][L] || '');
        const bad = v.replace(/\{\d+\}/g, '').match(/[_*[\]()~`>#+=|{}.!-]/g);
        if (bad) fail(`«${k}.${L}» فيه محرفٌ محجوزٌ في MarkdownV2 (${bad.join(' ')}) — رسالةُ تيليجرام ستسقط بلا أثر.`);
    }
}
for (const k of ['sd467_step9_qty', 'sd471_custom_qty_prompt', 'wa_add_qty', 'sd467_qty_edit', 'wa_ed_qty_cur']) {
    const v = (i18n[k] || {}).ar || '';
    if (/الكمية المتاحة|الكمية الحالية/.test(v)) {
        fail(`«${k}» ما زال يقول «الكمية المتاحة/الحالية» — والرقمُ المطلوب صار المخزون الكامل. صياغةٌ تكذب أسوأ من رقمٍ خاطئ.`);
    }
}

// ── ٧) الاستردادُ يُعيد الكمّية — في البابين ─────────────────────────────
// 🔴 طلبُ ناصر حرفياً: «وفي حالة الاسترداد ترجع الكميه كذلك». وقبله كان
//    استردادُ طلبٍ **مكتمل** لا يُعيد شيئاً، والإشعار يقول «البضاعة خرجت
//    فعلاً». والفخُّ الذي كاد يُسقط التنفيذ: **بابان لا باب** —
//    `resolve_booking_refund` (قرارُ التاجر) و`taki_settle_booking_refund`
//    (تسويةُ البوّابة، وهي التي تعمل في الردّ الفوريّ). رقعةُ أحدهما تُصلح
//    باباً لا يُفتح.
const m06 = code(read('supabase/JEDDAH_v15_06_refund_restock.sql'));
for (const [needle, why] of [
    ['taki_restock_booking', 'دالّةُ الإرجاع غائبة — لا شيء في القاعدة يزيد المخزون.'],
    ['resolve_booking_refund', 'بابُ قرار التاجر غيرُ مرقوع.'],
    ['taki_settle_booking_refund', 'بابُ تسوية البوّابة غيرُ مرقوع — وهو الذي يعمل في الردّ الفوريّ.'],
    ['restocked_qty', 'لا سجلَّ لما أُرجع — نداءان يُضاعفان البضاعة.'],
    ['taki_set_on_hand', 'الإرجاع لا يمرّ من الكاتب المُعلَن — المرايا المتاحة لن تُعاد اشتقاقها.'],
    ['FOR UPDATE', 'الإرجاع بلا قفل.'],
]) if (!m06.includes(needle)) fail(why);

// 🔴 ولا يُفتح حارسُ الحالة: الفاتورة الضريبية المجمّدة وتسلسلها بلا فجوات
//    يتّكئان على أن «مكتمل» حالةٌ نهائية. وفتحُه يبدو الطريقَ الطبيعي.
if (/guard_booking_status/.test(m06) && /CREATE OR REPLACE FUNCTION public\.guard_booking_status/.test(m06)) {
    fail('الهجرة تُعيد بناء `guard_booking_status` — الفاتورة الضريبية المجمّدة تتّكئ على نهائيّة «مكتمل».');
}
// والرسالةُ تتغيّر مع السلوك: نصٌّ يقول إن البضاعة لا تعود صار كذباً
if (!/البضاعة خرجت فعلاً/.test(read('supabase/JEDDAH_v15_06_refund_restock.sql'))) {
    fail('الهجرة لا تُبدّل نصّ «البضاعة خرجت فعلاً» — رسالةٌ تكذب على التاجر أسوأ من صمت.');
}
// 🔴 v15.11 — حُذف «الجواب الافتراضيّ» كلُّه: أربك مالكَ المنصّة نفسه، وما
//    أربك من بناه يُربك التاجر يقيناً. فلا يبقى إلا مفهومٌ واحد: **جوابُ
//    التاجر لهذا الطلب**، وافتراضُه «نعم رجعت». والحارس يمنع عودته إعداداً.
if (/refund_restocks/.test(read('src/components/seller/StorePoliciesCard.tsx'))) {
    fail('عاد «الجواب الافتراضيّ» إعداداً في بطاقة السياسات — والسؤالُ عند الضغط يكفي.');
}

// ── ٦) والقاعدة لا تُحيي بضاعةً مباعة عند إعادة التفعيل ──────────────────
const m05 = code(read('supabase/JEDDAH_v15_05_fix_bot_stock.sql'));
for (const [needle, why] of [
    ['IS DISTINCT FROM', 'حارسُ البيع ما زال يقارن بـ<>/= — حالةٌ NULL تُنقص المخزون.'],
    ['COALESCE(initial_quantity, quantity)', 'رقعةُ إعادة التفعيل غائبة — أوّل إعادة تفعيلٍ من البوت تُحيي ما بيع.'],
    ['(p_quantity = 0)', 'رقعةُ «صفر = بلا حدّ» غائبة — مفتاحُ «نفد» سيجعل العرض لا نهائياً.'],
]) if (!m05.includes(needle)) fail(why);

// ── ١٢) سلّة وزد: ما تأكّد من وثيقتَيهما، ولا وعدَ بما لا يُنفَّذ ────────
// 🔴 فُتحت وثيقتاهما فعلاً: **لا واحدةَ منهما تسمح للتاجر بتسجيل رابطٍ
//    بنفسه** (زد صريحة: مفتاحُ شريك + رمز OAuth؛ وسلّة عبر بوّابة الشركاء).
//    فشاشةٌ تقول له «الصق الرابط» عنهما تَعِده بما لا يُنفَّذ — وهو الفخّ
//    المسجَّل في v14.82 بعينه.
const prov2 = declCode(read('src/data/stockProviders.ts'));
if (!/selfServeWebhook/.test(prov2)) {
    fail('الكتالوج لا يقول أيُّ نظامٍ يقبل لصقَ رابطٍ من التاجر — فتَعِد الشاشةُ بما لا يُنفَّذ.');
}
if (!/id: 'zid',[\s\S]{0,400}selfServeWebhook: 'no'/.test(prov2)) {
    fail('زد غيرُ موسومةٍ بأنها لا تقبل لصقاً — ووثيقتُها صريحة.');
}
// وخريطةُ كلٍّ منهما من وثيقتها: سلّة بغلاف `data`، وزد في الجذر
// 🔴 v15.14 — خريطةُ زد كانت خطأً **خطيراً**: `variants: 'stocks'` تخلط
//    الفرعَ بالصنف، ولمنتجٍ له أصناف (structure='parent') يكون جذرُ الكمّية
//    صفراً و`stocks` فارغةً — فكانت ستُصفّر مخزون التاجر من رسالةٍ واحدة.
//    الأرقامُ الحقيقية في `variants[].stocks[]` وحدها. يُثبَّت الصحيحُ هنا
//    كي لا يعود الخطأ، ويُرفض القديمُ بعينه.
if (/id: 'zid',[\s\S]{0,600}variants: 'stocks'/.test(prov2)) {
    fail('خريطةُ زد تخلط الفرعَ بالصنف (`variants: \'stocks\'`) — `stocks[]` عندهم **لكلّ فرع**، والأصنافُ في `variants[]`. هذا يُصفّر مخزون التاجر.');
}
if (!/id: 'zid',[\s\S]{0,600}locations: 'stocks'/.test(prov2)) {
    fail('خريطةُ زد بلا محورِ فروع — و`stocks[]` عندهم هي الفروع.');
}
// والعدمُ ليس صفراً: `is_infinite: true` ⇒ الكمّيةُ `null`، وهو مثالُ زد نفسها.
for (const pid of ['zid', 'salla']) {
    const re = new RegExp(`id: '${pid}',[\\s\\S]{0,900}unlimitedFlag:`);
    if (!re.test(prov2)) {
        fail(`«${pid}» بلا \`unlimitedFlag\` — فتُقرأ «بلا حدّ» صفراً، ومثالُ وثيقتهم الرسميّ هو هذه الحالة بعينها.`);
    }
    const rt = new RegExp(`id: '${pid}',[\\s\\S]{0,900}truthRead:`);
    if (!rt.test(prov2)) {
        fail(`«${pid}» بلا \`truthRead\` — ولا واحدٌ منهما يُرسل حدثاً للمخزون، فالرسالةُ إشارةٌ والرقمُ يُقرأ من واجهته.`);
    }
}
// 🪤 وحقلٌ نطلبه ولا نقرؤه يُربك التاجر بلا مقابل — واعتراضُه كان عنه.
if (/placeholder=\{t\('رابط المنتج عندهم/.test(jsCode(read('src/components/seller/StockLinkCard.tsx')))) {
    fail('عاد حقلُ «رابط المنتج عندهم» — وقِيس أنه لا يُقرأ في أيّ مكان.');
}
if (!/لا نقرأ مخزونك من رابط/.test(read('src/components/seller/StockLinkCard.tsx'))) {
    fail('الشاشة لا تقول للتاجر إنّ المخزون لا يُقرأ من رابط — وهو سؤالُ ناصر الحرفيّ.');
}
if (!/fieldMap: \{ id: 'data\.id', qty: 'data\.quantity'/.test(prov2)) {
    fail('خريطةُ سلّة ليست `data.id`/`data.quantity` — وهي مؤكَّدةٌ من وثيقتهم.');
}
if (!/fieldMap: \{ id: 'id', qty: 'quantity'/.test(prov2)) {
    fail('خريطةُ زد ليست في الجذر — ورسالتُهم بلا غلاف.');
}
const m13 = code(read('supabase/JEDDAH_v15_13_provider_maps.sql'));
if (!m13.includes('_taki_provider_map')) fail('القاعدة لا تحمل خرائط المزوّدين المؤكَّدة.');
// والشاشةُ تعرض ما يلزم بدل أن تَعِد
const card3 = jsCode(read('src/components/seller/StockLinkCard.tsx'));
if (!/selfServeWebhook !== 'yes'/.test(card3)) {
    fail('الشاشة لا تفرّق بين نظامٍ يقبل اللصق وآخر لا يقبله.');
}

// ── ١١) اتجاهُ الرابط: تاكي تُعطيه ولا تطلبه ────────────────────────────
// 🔴 اعتراضُ ناصر على الشاشة: «لم أفهم سبب طلبك للرابط وأيّ رابط تقصد أن
//    يضع». وكان محقّاً — الأنظمة (سلّة · زد · أغلب نقاط البيع) **تُرسل ولا
//    تستقبل**، فطلبُ عنوانٍ منه يعني أن يبني مبرمجُه نقطةَ استقبال، وهو لا
//    يملك مبرمجاً. الاتجاهُ الصحيح: تاكي تُصدر رابطاً يلصقه مرّةً واحدة.
const hookFn = read('supabase/functions/stock-webhook/index.ts');
for (const [needle, why] of [
    ['x-taki-key', 'الخطّافُ لا يقبل المفتاح في ترويسة — وهي أسلم من الرابط.'],
    ['KEY_REQUIRED', 'الخطّافُ يقبل نداءً بلا مفتاح — وهو سطحٌ عامّ يرث VERIFY_JWT=false.'],
    ['BODY_TOO_LARGE', 'لا سقفَ لحجم الجسم — سطحُ إنهاكٍ مجّانيّ.'],
    ['NOT_CONFIGURED', 'يفشل مفتوحاً بلا بيئةٍ صحيحة بدل أن يفشل مغلقاً.'],
]) if (!hookFn.includes(needle)) fail(`«stock-webhook» ${why}`);
// 🪤 و200 حتى لرسالةٍ لم تُفهم: رفضُها يجعل المرسِل يُعيدها إلى الأبد،
//    وبعضُ الأنظمة تُعطّل الخطّاف بعد فشلٍ متكرّر.
if (!/unmapped/.test(hookFn)) {
    fail('«stock-webhook» لا يميّز رسالةً لم تُفهم — سيردّ خطأً فيُعيدها المرسِل بلا نهاية.');
}

const m12 = code(read('supabase/JEDDAH_v15_12_webhook_in.sql'));
for (const [needle, why] of [
    ['last_payload', 'لا تُحفظ الرسالةُ كما وصلت — فلا دليلَ على شكلها الحقيقي، ولا يبقى إلا التخمين.'],
    ['UNMAPPED', 'لا حالةَ لرسالةٍ لم تُفهم.'],
    ['merchant_set_field_map', 'لا سبيلَ لربط الحقول من الرسالة الحقيقية.'],
    ['QTY_PATH_NOT_A_NUMBER', 'تُقبل خريطةٌ لا تعمل — فتسكت المزامنةُ بصمت والتاجر يظنّها تعمل.'],
]) if (!m12.includes(needle)) fail(why);

// والشاشةُ تُعطي الرابط وتشرح أين يُلصق
const card2 = jsCode(read('src/components/seller/StockLinkCard.tsx'));
if (!/stock-webhook\?k=/.test(card2)) {
    fail('الشاشة لا تعرض رابطَ الاستقبال — فيبقى التاجر يبحث عمّا يلصقه.');
}
if (!/pasteHint/.test(card2)) {
    fail('الشاشة لا تقول **أين** يُلصق الرابط في نظامه — وهذا بالضبط ما لم يفهمه ناصر.');
}
if (!/merchant_set_field_map/.test(card2)) {
    fail('الشاشة لا تتيح ربطَ حقول رسالةٍ لم تُفهم.');
}
if (!/دوّر المفتاح|Rotate key/.test(card2)) {
    fail('لا مخرجَ لمن فقد الرابط — والمفتاح لا يُسترجع لأنه لا يُخزَّن.');
}
const prov = read('src/data/stockProviders.ts');
if (!/pasteHintAr/.test(prov)) fail('الكتالوج بلا إرشادِ لصقٍ لكل نظام.');

// ── ١٠) شاشةُ ربط نظام التاجر ────────────────────────────────────────────
// 🪤 شاشةٌ تُنشئ ولا تُلغي تترك التاجر أمام حالةٍ بلا مخرج — وهي القاعدة التي
//    بُنيت لأجلها شاشةُ «ردودٌ عالقة». فكلُّ بابٍ من الستّة يجب أن تناديه.
const card = jsCode(read('src/components/seller/StockLinkCard.tsx'));
for (const [fn, why] of [
    ['merchant_create_integration', 'الشاشة لا تُنشئ ربطاً.'],
    ['merchant_link_product', 'الشاشة لا تربط منتجاً بكوده — وبلا الربط لا يعرف الطرفان أن المنتج واحد.'],
    ['merchant_update_integration', 'لا إطفاءَ للربط — حالةٌ بلا مخرج.'],
    ['merchant_rotate_integration_key', 'لا تدويرَ للمفتاح — ومن فقده لا يستعيده (لا يُخزَّن أصلاً).'],
    ['merchant_delete_integration', 'لا حذفَ للربط.'],
    ['merchant_unlink_product', 'لا فكَّ ربطٍ لمنتج.'],
]) if (!card.includes(fn)) fail(`«StockLinkCard» ${why}`);

// 🔴 والمفتاح يُعرض مرّةً واحدة — والشاشة تقول ذلك **قبل** أن يُغلق لا بعده
if (!/shown_once|لن يظهر مرّةً أخرى|not be shown again/.test(card)) {
    fail('الشاشة لا تُنبّه أن المفتاح يُعرض مرّةً واحدة — وتاكي لا تحتفظ به فلا تستطيع استرجاعه.');
}
// ولا تُطلب أعمدةٌ سرّية: طلبُها يرفع 42501 ويُفرغ البطاقة
if (/api_key_hash|webhook_secret/.test(card)) {
    fail('الشاشة تطلب عموداً سرّياً — المنحُ يمنعه فترتدّ البطاقة بخطأ صلاحية.');
}
// والإفصاحُ عن قطاعٍ لا نستطيع تمثيله معروضٌ للتاجر لا مدفونٌ في ملفّ
if (!/blockedReason/.test(card)) {
    fail('الشاشة لا تعرض سببَ تعذّر قطاعٍ (الفنادق) — تصنيفٌ بلا إفصاحٍ وعدٌ بما لا يُنفَّذ.');
}
if (!/StockLinkCard/.test(read('src/pages/SellerDashboard.tsx'))) {
    fail('الشاشة غيرُ مركَّبة في لوحة التاجر — واجهةٌ لا يصلها أحد.');
}
const m10 = code(read('supabase/JEDDAH_v15_10_integration_doors.sql'));
if (!m10.includes('NOT_YOURS')) {
    fail('أبوابُ v15.10 بلا فحص ملكية — RLS لا تحرس دالّةً مالكة.');
}

// ── ٩) التاجرُ يُسأل عند كلّ ردّ — لا إعدادٌ صامت ───────────────────────
// 🔴 قرارُ ناصر: «يُسأل التاجر وهو يردّ، لأن بعضهم يعطي المشتري القطعة
//    المعيبة كهدية ويردّ المال في الوقت نفسه». فالجوابُ **واقعةُ طلبٍ** لا
//    سياسةُ متجر — وإعدادٌ واحدٌ ثابت لا يصدُق في الحالتين.
const m09 = code(read('supabase/JEDDAH_v15_09_ask_merchant.sql'));
for (const [needle, why] of [
    ['refund_restock', 'لا عمودَ يحمل جوابَ التاجر — سيضيع في رحلة البوّابة.'],
    ['COALESCE(v_b.refund_restock', 'التسويةُ لا تقرأ الجواب — الإعدادُ الصامت باقٍ.'],
    ['COALESCE(p_restock', 'البابُ اليدويّ لا يقرأ الجواب.'],
    ['v_restocked', 'لا متغيّرَ يحمل ما حدث فعلاً — والرسالةُ ستقول «أُلغي الطلب» لطلبٍ مكتملٍ لم يُلغَ.'],
]) if (!m09.includes(needle)) fail(why);

// والسؤالُ مطروحٌ في شاشتَي الردّ معاً — لا في واحدة
for (const f of ['src/components/seller/RefundButton.tsx', 'src/components/seller/RefundPanel.tsx']) {
    const src = jsCode(read(f));
    if (!/رجعت البضاعة/.test(src)) {
        fail(`«${f}» لا يسأل التاجر «رجعت البضاعة؟» — والجوابُ يخصّ كلّ طلبٍ على حدة.`);
    }
    if (!/restock/.test(src)) fail(`«${f}» لا يُمرّر جوابَ التاجر إلى القاعدة.`);
}
// ودالّةُ الحافة تنقل الجواب عبر رحلة البوّابة
if (!/p_restock/.test(read('supabase/functions/merchant-pay/index.ts'))) {
    fail('دالّةُ الحافة لا تُمرّر جوابَ التاجر — الزرُّ يسأل والقاعدةُ لا تسمع.');
}
// 🪤 والنصُّ القديم «لن تعود كمّيته — البضاعة خرجت» صار كذباً بعد v15.06
for (const f of ['src/components/seller/RefundButton.tsx', 'src/components/seller/RefundPanel.tsx']) {
    if (/البضاعة خرجت/.test(read(f))) {
        fail(`«${f}» ما زال يقول للتاجر «البضاعة خرجت» — والكمّية صارت تعود إن أجاب بنعم.`);
    }
}

// ── ٨) الربطُ بأنظمة التجار — عقدٌ يحرس نفسه ─────────────────────────────
const m08 = code(read('supabase/JEDDAH_v15_08_integrations.sql'));
for (const [needle, why] of [
    ['taki_rate_check', 'البابُ الوارد بلا حدّ معدّل — وهو مفتوحٌ للإنترنت (VERIFY_JWT=false على هذا الخادم).'],
    ['stock_inbox', 'لا مفتاحَ تكرارٍ للوارد — إعادةُ محاولةٍ عند انقطاعٍ تُطبَّق الرسالة مرّتين.'],
    ['digest', 'مفتاحُ التاجر يُقارن خاماً بدل بصمته.'],
    ['ux_stock_links_ext', 'لا قيدَ تفرّدٍ على الكود الخارجيّ — دفعةٌ واحدة قد تكتب في عرضين.'],
    ['FOR UPDATE SKIP LOCKED', 'عاملُ التسليم بلا حجزٍ للصفّ — عاملان يُرسلان نفس الحدث.'],
]) if (!m08.includes(needle)) fail(why);

// والعاملُ لا يستعمل pg_net: نداؤه «أطلِق وانسَ» ولا يقرأ الردّ
const sync = jsCode(read('server/lib/stockSync.js'));
if (!/createHmac/.test(sync)) fail('أحداثُ المخزون تُرسل بلا توقيع — أيُّ أحدٍ يزعم أنه تاكي.');
if (!/bot_mark_stock_event/.test(sync)) fail('العاملُ لا يُعلّم النتيجة — حدثٌ مسحوبٌ يبقى معلّقاً إلى الأبد.');
if (!/catch/.test(sync)) fail('العاملُ قد يرمي داخل `setInterval` فيُسقط البوت كلَّه.');

// والكتالوجُ يحمل حقلَ تحقُّقٍ صريح — لا نثراً
const cat = read('src/data/stockProviders.ts');
if (!/apiVerified|publicApi:\s*'unverified'|'unverified'/.test(cat)) {
    fail('كتالوجُ المزوّدين بلا وسم «غير مؤكَّد» — وقد سبق أن أنتج مسحُ توثيقٍ اسمَ حقلٍ مختلَقاً.');
}
if (!/blockedReason/.test(cat)) {
    fail('الكتالوج لا يُفصح عن قطاعٍ لا يستطيع تاكي تمثيله — الفنادق تُباع اليوم بالقطعة لا بالليلة.');
}

// ── ٥) والإثباتُ الغازي مفصولٌ عن الهجرة ──────────────────────────────────
// (إدراجُ حجزٍ وهميّ يمرّ على ١٨ مشغّلاً ويكتب فواتير وإشعارات — لا مكانَ له
//  في هجرةٍ تُطبَّق على الإنتاج.)
if (/INSERT INTO public\.bookings/.test(m02) || /INSERT INTO public\.bookings/.test(m03)) {
    fail('هجرةٌ تُدرج حجزاً في `bookings` — الاختبارُ الغازي مكانُه `supabase/proof_v15_03_hold_survives.sql` داخل معاملةٍ تُلغى.');
}
read('supabase/proof_v15_03_hold_survives.sql');

console.log('✅ حارس المخزون: الواجهة والبوتان بالكامل · المتاح مشتقّ · الاستردادُ يُعيد في البابين · والراية تُطفأ');
