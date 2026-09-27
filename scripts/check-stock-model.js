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
const jsCode = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

// ── ٦) والقاعدة لا تُحيي بضاعةً مباعة عند إعادة التفعيل ──────────────────
const m05 = code(read('supabase/JEDDAH_v15_05_fix_bot_stock.sql'));
for (const [needle, why] of [
    ['IS DISTINCT FROM', 'حارسُ البيع ما زال يقارن بـ<>/= — حالةٌ NULL تُنقص المخزون.'],
    ['COALESCE(initial_quantity, quantity)', 'رقعةُ إعادة التفعيل غائبة — أوّل إعادة تفعيلٍ من البوت تُحيي ما بيع.'],
    ['(p_quantity = 0)', 'رقعةُ «صفر = بلا حدّ» غائبة — مفتاحُ «نفد» سيجعل العرض لا نهائياً.'],
]) if (!m05.includes(needle)) fail(why);

// ── ٥) والإثباتُ الغازي مفصولٌ عن الهجرة ──────────────────────────────────
// (إدراجُ حجزٍ وهميّ يمرّ على ١٨ مشغّلاً ويكتب فواتير وإشعارات — لا مكانَ له
//  في هجرةٍ تُطبَّق على الإنتاج.)
if (/INSERT INTO public\.bookings/.test(m02) || /INSERT INTO public\.bookings/.test(m03)) {
    fail('هجرةٌ تُدرج حجزاً في `bookings` — الاختبارُ الغازي مكانُه `supabase/proof_v15_03_hold_survives.sql` داخل معاملةٍ تُلغى.');
}
read('supabase/proof_v15_03_hold_survives.sql');

console.log('✅ حارس المخزون: الواجهة والبوتان يُبذَرون بالكامل · القاعدة تشتقّ المتاح · الحجزُ لا يُفسَّر إعلاناً · والراية تُطفأ');
