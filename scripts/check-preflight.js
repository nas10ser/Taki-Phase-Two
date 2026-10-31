// حارسُ «ما يمنع الحجز يُقال على صفحة العرض» (v15.36)
// التشغيل: node scripts/check-preflight.js
//
// ── بلاغُ ناصر ─────────────────────────────────────────────────────────────
// «لو لم يُختر منتج أو كانت المسافة بعيدة وضُغط الحجز، اجعله لا يتمّ من نفس
//  الصفحة — لا من الصفحة التي بعدها.»
// وكان: «اختر مقاساً» داخل التأكيد النهائي، وحارسُ المسافة يسأل عن **أقرب**
// فرعٍ لا عن **المختار** (الخبر ١٢ كم والباحة مول ١١٢٩ والمختارُ الثاني ⇒ يمرّ).
//
// 🪤 والوحدةُ TypeScript فتُصرَّف في الذاكرة بمُصرِّف المشروع نفسه — لا تُعاد
//    كتابتُها هنا: اختبارٌ يقيس نسخةً ثانيةً لا يقيس شيئاً.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/bookingPreflight.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { bookingPreflight, preflightMessage, deliveryBlockReason, MAX_PICKUP_KM } = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};
const BASE = { isRTL: true, hasVariants: false, variantPiecesTotal: 0, selectedKm: null, holdText: 'ساعتان' };
const run = (o) => bookingPreflight({ ...BASE, ...o });
const has = (arr, needle) => arr.some(x => x.includes(needle));

// ── ١) حالةٌ موجبة أوّلاً: الطريقُ السالك يبقى سالكاً ───────────────────────
check('سالك: عرضٌ بلا أنواع وموقعٌ مجهول', run({}).length === 0, JSON.stringify(run({})));
check('سالك: نوعٌ مختارٌ وفرعٌ قريب',
    run({ hasVariants: true, variantPiecesTotal: 2, selectedKm: 9,
          picks: [{ label: 'كبير', sel: 2, cap: 5 }] }).length === 0);
check('سالك: خانةٌ مفتوحة (cap غائب) لا تُحسب نفاداً',
    run({ hasVariants: true, variantPiecesTotal: 1, picks: [{ label: 'كبير', sel: 1, cap: undefined }] }).length === 0);

// ── ٢) لم يختر منتجاً — بلاغُ ناصر الأول ───────────────────────────────────
check('يُمنع: عرضٌ بأنواعٍ بلا اختيار',
    has(run({ hasVariants: true, variantPiecesTotal: 0 }), 'لم تختر الحجم'));
check('ولا يُتّهم عرضٌ بلا أنواع',
    !has(run({ hasVariants: false, variantPiecesTotal: 0 }), 'لم تختر الحجم'));

// ── ٣) المسافة — ويُسأل عن **المختار** لا عن الأقرب ─────────────────────────
const far = run({ selectedKm: 1129.6, selectedName: 'الباحة مول', nearestKm: 12.3, nearestName: 'الخبر' });
check('يُمنع: الفرعُ المختار بعيدٌ وإن كان غيرُه قريباً', has(far, '1130') && has(far, 'الباحة مول'),
    JSON.stringify(far));
check('ويُقترح الأقربُ بالاسم والمسافة', has(far, 'الخبر') && has(far, '12'), JSON.stringify(far));
check('يُمنع: كلُّ الفروع بعيدة ⇒ «ابحث عن عرض أقرب»',
    has(run({ selectedKm: 900, nearestKm: 900, nearestName: 'أ', selectedName: 'أ' }), 'ابحث عن عرض أقرب'));
check('سالك: المختارُ على الحدّ بالضبط', run({ selectedKm: MAX_PICKUP_KM, nearestKm: 10 }).length === 0);
check('سالك: الموقعُ مجهول ⇒ لا حكم', run({ selectedKm: null, nearestKm: null }).length === 0);
// 🪤 مَن يصله الطلبُ إلى بابه لا يعنيه بُعدُ الفرع — ونطاقُ التوصيل هو الحاكم.
check('سالك: التوصيلُ متاح ⇒ المسافةُ ليست مانعاً',
    run({ selectedKm: 1129, nearestKm: 12, deliveryPossible: true }).length === 0);

// ── ٤) السقفُ والنفادُ في الفرع المختار ────────────────────────────────────
check('يُمنع: نوعٌ نفد في هذا الفرع (cap = 0)',
    has(run({ hasVariants: true, variantPiecesTotal: 1, picks: [{ label: 'كبير', sel: 1, cap: 0 }] }), 'غير متوفر في الفرع المختار'));
check('يُمنع: الكمّيةُ تتجاوز سقفَ الفرع',
    has(run({ hasVariants: true, variantPiecesTotal: 9, picks: [{ label: 'كبير', sel: 9, cap: 3 }] }), 'خفّف الكمية'));
check('ولا يُتّهم نوعٌ لم يُختر (sel = 0) وإن نفد',
    run({ hasVariants: true, variantPiecesTotal: 1,
          picks: [{ label: 'كبير', sel: 0, cap: 0 }, { label: 'صغير', sel: 1, cap: 5 }] }).length === 0);

// ── ٥) الأسبابُ تُجمع في رسالةٍ واحدة (لا واحدةً تلو أخرى) ──────────────────
const both = run({ hasVariants: true, variantPiecesTotal: 0, selectedKm: 1129.6,
                   selectedName: 'الباحة مول', nearestKm: 12.3, nearestName: 'الخبر' });
check('سببان معاً في نداءٍ واحد', both.length === 2, JSON.stringify(both));
const msg = preflightMessage(both, true);
check('والرسالةُ مرقّمةٌ حين تتعدّد', msg.includes('1)') && msg.includes('2)') && msg.includes('صحّح ما يلي'));
check('وسببٌ واحد يُعرض بلا ترقيم', preflightMessage([both[0]], true) === both[0]);

// ── ٦) الإنجليزية موجودة لكل رسالة ─────────────────────────────────────────
const en = bookingPreflight({ ...BASE, isRTL: false, hasVariants: true, variantPiecesTotal: 0,
    selectedKm: 1129, selectedName: 'A', nearestKm: 12, nearestName: 'B', holdText: 'two hours' });
check('الإنجليزية: لا عربيةَ متسرّبة', en.length === 2 && !/[؀-ۿ]/.test(en.join(' ')), JSON.stringify(en));

// ── ٧) 🪤 لا رقمَ ساعاتٍ مثبَّت: المهلةُ تُمرَّر (قاعدة v14.10) ────────────────
check('نصُّ المهلة يُمرَّر لا يُكتب',
    has(run({ selectedKm: 900, holdText: 'ستّ ساعات' }), 'ستّ ساعات')
    && !/ساعتان|ساعتين|2 hours/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    'نصُّ المهلة مكتوبٌ داخل الوحدة');

// ── ٨) سببُ تعذّر التوصيل ─────────────────────────────────────────────────
const D = { isRTL: true, on: true, hasAddress: true, loading: false, available: true, gateReady: true, belowMin: false, minOrder: 0, total: 0 };
check('التوصيل مطفأ ⇒ لا رسالة', deliveryBlockReason({ ...D, on: false }) === null);
check('كلُّ الشروط سليمة ⇒ لا رسالة', deliveryBlockReason(D) === null);
check('بلا عنوان ⇒ يُرشَد إلى الإعدادات', (deliveryBlockReason({ ...D, hasAddress: false }) || '').includes('حسابي'));
check('no_zones ≠ out_of_zone', (deliveryBlockReason({ ...D, available: false, reason: 'no_zones' }) || '').includes('لم يحدّد نطاق'));
check('out_of_zone يقترح عنواناً أو فرعاً', (deliveryBlockReason({ ...D, available: false, reason: 'out_of_zone' }) || '').includes('خارج نطاق'));
check('تحت الحدّ الأدنى يقول كم ينقص', (deliveryBlockReason({ ...D, belowMin: true, minOrder: 50, total: 30 }) || '').includes('20'));

// ── ٩) وموصولٌ فعلاً بالزرّ ───────────────────────────────────────────────
// 🪤 حارسٌ سليمٌ غيرُ موصولٍ ليس حارساً — وقع مرّتين في هذا المشروع (v14.86).
//    ويُجرَّد التعليقُ أوّلاً وإلّا طابق الحارسُ شرحَه هو.
const page = fs.readFileSync(path.join(__dirname, '..', 'src/pages/DealDetails.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('الزرُّ يفحص **قبل** فتح الورقة',
    /const stop = preflightStop\(\);\s*if \(stop\.length\)[\s\S]{0,160}?return; \}\s*setShowBookingModal\(true\)/.test(page));
check('ولم يبقَ حارسُ المسافة القديم وحده', !/blockedByDistance/.test(page));
check('والاختيارُ التلقائيّ يُعاد عند وصول المسافات',
    /locChosen\.current \|\| variantPiecesTotal > 0/.test(page) && /locChosen\.current = true/.test(page));

console.log(fail === 0
    ? `✅ ما يمنع الحجز: ${pass} فحصاً — يُقال على صفحة العرض، ومجموعاً، وبالفرع المختار`
    : `❌ ${fail} فشل من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
