#!/usr/bin/env node
/**
 * نسبةُ خصم العرض — اختبارٌ **تنفيذيّ**: يُترجَم المكوّنُ الحقيقيُّ ويُشغَّل.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الطلب (ناصر ١٧ نوفمبر): «لا يوجد خيار يحدد السعر على نسبة الخصم اللي انا
 *    احدده». وقبل v16.33 كانت النسبةُ مخرَجاً في اتجاهٍ واحد: تُحسب من
 *    السعرين وتُعرض شارةً للقراءة، ولا سبيلَ للكتابة فيها.
 *
 * وما يحرسه هذا الملفّ ثلاثةُ أشياءَ يسهل أن تنكسر بصمت:
 *   ① **الرحلةُ ذهاباً وإياباً**: نسبةٌ تُكتب ⇒ سعرٌ يُحسب ⇒ نسبةٌ تُشتقّ من
 *      السعرين **يجب أن تساوي ما كُتب**. وبالقصّ بدل التقريب تختلف — فيكتب
 *      التاجر ٢٥٪ فيرى ٢٤٪.
 *   ② **الحقلُ ليس ميّتاً**: يُصيَّر فعلاً، ويُعطَّل مع السعرين حين تُدار
 *      الأسعارُ من «أنواع المنتج» (فخُّ «الحقل الميّت»، v16.30).
 *   ③ **لا عرضَ مجّانيّ بالخطأ**: ١٠٠٪ وما فوقها وما دون ١٪ تُرفض، ولا
 *      تُرجع صفراً — الصفرُ سعرٌ صالحٌ في الحساب فيمرّ.
 *
 * 🪤 والقياسُ بالتصيير لا بـ`grep`: أسماءُ الدوالّ تذوب بالتصغير، وحقلٌ مكتوبٌ
 *    في المصدر قد لا يُصيَّر إطلاقاً لفرعٍ شرطيّ.
 */
const cp = require('child_process');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
const check = (n, ok, d) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${n}`);
    if (!ok && d) console.log('      ' + d);
    ok ? pass++ : fail++;
};

console.log('\nنسبةُ خصم العرض — تُكتب فيُحسب السعر');

// 🪤 المخرَجُ **داخل المشروع**: المكوّن ينادي `require('react')`، وحلُّ
//    الوحدات يصعد من موضع الملفّ — فمجلّدٌ في /tmp لا يرى `node_modules`.
const out = path.join(root, 'node_modules', '.cache-deal-pct');
fs.rmSync(out, { recursive: true, force: true });

const tsc = cp.spawnSync('npx', ['tsc',
    path.join(root, 'src/components/seller/DealPriceFields.tsx'),
    '--outDir', out, '--module', 'commonjs', '--target', 'es2020',
    '--jsx', 'react-jsx', '--esModuleInterop', '--skipLibCheck',
    '--moduleResolution', 'node'],
{ cwd: root, encoding: 'utf8' });

// 🪤 ولا يُشترط `status === 0`: المكوّنُ يستورد `../../utils/*` فيجرّ أنواعاً
//    قد تُنتج تحذيراتٍ هنا، والمهمّ أن يُكتب الملفُّ ويُشغَّل.
const mod = path.join(out, 'components/seller/DealPriceFields.js');
const built = fs.existsSync(mod) ? mod : path.join(out, 'DealPriceFields.js');
if (!fs.existsSync(built)) {
    check('ترجمةُ المكوّن', false, String(tsc.stdout || tsc.stderr).slice(0, 500));
    console.log(`\n❌ نسبةُ الخصم: ${pass} ناجحاً · ${fail} فاشلاً`);
    process.exit(1);
}
// 🪤 `utils/helpers.ts` يُعيد تصديرَ `waLink` من `../../shared/phone` — وهو
//    خارج `src/`، فبنيةُ المخرَج تجعل ذلك المسار يُحلّ إلى `node_modules/shared`
//    فيسقط الاستيرادُ كلُّه بـMODULE_NOT_FOUND. يُعاد توجيهُه إلى الملفّ
//    الحقيقيّ بدل نسخِ مجلّداتٍ داخل `node_modules`.
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
    if (/[\\/]shared[\\/]phone$/.test(req)) return path.join(root, 'shared', 'phone.js');
    return origResolve.call(this, req, ...rest);
};

const C = require(built);
const { priceFromPct, PCT_MIN, PCT_MAX } = C;

// ── ① الرحلةُ ذهاباً وإياباً ──────────────────────────────────────────────
// النسبةُ الراجعة تُحسب بنفس تعبير `SellerDashboard.tsx` حرفاً
// (`Math.round(((o - d) / o) * 100)`) — فما يُقاس هو ما سيراه التاجر.
const backPct = (o, d) => Math.round(((o - d) / o) * 100);
let worst = null, cases = 0;
for (let cents = 100; cents <= 500000; cents += 7) {       // ١٫٠٠ ← ٥٠٠٠٫٠٠ ر.س
    const o = cents / 100;
    for (const p of [1, 5, 10, 15, 20, 25, 30, 33, 40, 50, 60, 70, 75, 80, 90, 99]) {
        const d = priceFromPct(o, p);
        cases++;
        if (d === null || backPct(o, d) !== p) { worst = { o, p, d, back: d === null ? null : backPct(o, d) }; break; }
    }
    if (worst) break;
}
check(`النسبةُ المكتوبة = النسبةُ الظاهرة، في ${cases} حالةً من ١ ر.س إلى ٥٠٠٠ ر.س`,
    !worst,
    worst && `عند سعر ${worst.o} ونسبة ${worst.p}٪ ⇒ السعر ${worst.d} والنسبةُ الراجعة ${worst.back}`);

check('٢٥٪ من ٩٩ ر.س = ٧٤٫٢٥ (تقريبٌ لا قصّ)', priceFromPct(99, 25) === 74.25, String(priceFromPct(99, 25)));
check('٣٣٪ من ٩٩ ر.س = ٦٦٫٣٣', priceFromPct(99, 33) === 66.33, String(priceFromPct(99, 33)));

// ── ③ لا عرضَ مجّانيّ ولا مدخلٌ فاسد ─────────────────────────────────────
check('١٠٠٪ مرفوضة (كانت ستُنتج سعراً صفراً)', priceFromPct(100, 100) === null, String(priceFromPct(100, 100)));
check('٠٪ مرفوضة', priceFromPct(100, 0) === null, String(priceFromPct(100, 0)));
check('نسبةٌ سالبة مرفوضة', priceFromPct(100, -5) === null, String(priceFromPct(100, -5)));
check('سعرٌ أصليٌّ صفر أو سالب مرفوض', priceFromPct(0, 25) === null && priceFromPct(-9, 25) === null);
check('NaN مرفوضة ولا تُرجع صفراً', priceFromPct(NaN, 25) === null && priceFromPct(100, NaN) === null);
check('الحدّان ١ و٩٩ مقبولان', priceFromPct(100, PCT_MIN) === 99 && priceFromPct(100, PCT_MAX) === 1,
    `${priceFromPct(100, PCT_MIN)} · ${priceFromPct(100, PCT_MAX)}`);

// ── ② الحقلُ يُصيَّر فعلاً، ويُعطَّل مع السعرين ──────────────────────────
let React, renderToStaticMarkup;
try {
    React = require(path.join(root, 'node_modules/react'));
    ({ renderToStaticMarkup } = require(path.join(root, 'node_modules/react-dom/server')));
} catch (e) { check('تحميلُ React', false, e.message); }

if (renderToStaticMarkup) {
    const props = (over) => ({
        isRTL: true, originalPrice: '100', discountedPrice: '75',
        setOriginalPrice: () => {}, setDiscountedPrice: () => {},
        discount: 25, variantsDriving: false, priceInvalid: false,
        vatRegistered: false, vatRate: 15,
        inputGroupStyle: {}, labelStyle: {}, fieldInputStyle: {},
        ...over,
    });
    const Cmp = C.DealPriceFields || C.default;
    const live = renderToStaticMarkup(React.createElement(Cmp, props()));
    check('حقلُ النسبة مُصيَّرٌ فعلاً', live.includes('id="deal-pct"'), live.slice(0, 160));
    check('ويعرض النسبةَ المشتقّة من السعرين (٢٥)', /id="deal-pct"[^>]*value="25"/.test(live),
        (live.match(/<input id="deal-pct"[^>]*>/) || [''])[0].slice(0, 200));
    check('ويظهر السعران معه', live.includes('value="100"') && live.includes('value="75"'));

    const driven = renderToStaticMarkup(React.createElement(Cmp, props({ variantsDriving: true })));
    const tag = (driven.match(/<input id="deal-pct"[^>]*>/) || [''])[0];
    check('ويُعطَّل حين تُدار الأسعار من «أنواع المنتج» — فلا يكون حقلاً ميّتاً',
        tag.includes('disabled'), tag.slice(0, 200));
}

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} نسبةُ الخصم: ${pass} ناجحاً · ${fail} فاشلاً`);
process.exit(fail ? 1 : 0);
